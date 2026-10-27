const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool, types } = require("pg");

// Keep PostgreSQL BIGINT IDs as JavaScript numbers for compatibility with the frontend.
types.setTypeParser(20, value => Number(value));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add your Neon connection string in the hosting environment.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is missing. Add a secure secret in the hosting environment.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "kindconnect-local-development-only",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('donor','ngo','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ngos (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT '🤝',
  about TEXT NOT NULL,
  mission TEXT NOT NULL,
  what_they_do TEXT NOT NULL,
  motto TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  website TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  map_query TEXT,
  avatar_data TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS requirements (
  id BIGSERIAL PRIMARY KEY,
  ngo_id BIGINT NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  needed INTEGER NOT NULL CHECK (needed >= 0),
  fulfilled INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled >= 0),
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  unit TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pledges (
  id BIGSERIAL PRIMARY KEY,
  donor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requirement_id BIGINT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'pledged' CHECK (status IN ('pledged','confirmed','completed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT '';
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES users(id);
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS avatar_data TEXT NOT NULL DEFAULT '';
`;

const baseNGOs = [
  ["Akanksha Organization","akanksha-organization","🎓","Education-focused community support organisation.","Empower children and young adults through high-quality education.","Schools, education support, learning resources and student wellbeing.","Be the Change.","Erandwane, Pune","+91 20 6605 1380","fundraise@akanksha.org","https://akanksha.org/",1],
  ["Akanksha Foundation","akanksha-foundation","📚","A nonprofit focused on holistic education for children and young adults from underserved communities.","Build high-performing and innovative schools and empower students.","Education, life skills, sports, arts and student wellbeing.","Be the Change.","Wakadewadi, Pune","+91 20 6605 1380","fundraise@akanksha.org","https://akanksha.org/",1],
  ["Spherule Foundation","spherule-foundation","🎒","A Pune-based organisation working on practical community and education support.","Connect useful resources with people and communities who need them.","Education and community support including school supplies and essential goods.","Make every contribution useful.","Viman Nagar, Pune","+91 7276021861","","https://spherule.org/",1],
  ["JOSHConnect Foundation","joshconnect-foundation","🎒","A community-focused organisation connecting people with practical support initiatives.","Create meaningful community impact by connecting resources with people who need them.","Education, livelihood and essential-support initiatives.","Connect resources. Create change.","Kharadi, Pune","+91 9359876467","","https://www.joshconnect.org/",1],
  ["Seva Sahayog Foundation","seva-sahayog-foundation","🤲","A Pune community organisation supporting people through education, food and essential goods.","Strengthen communities through service and practical support.","Community essentials, education and support programmes.","Seva through community.","Navi Peth, Pune","020 24537655","","https://sevasahayog.org/",1],
  ["Helpage India","helpage-india-pune","❤️","An organisation working to support older people and their wellbeing.","Enable a dignified and secure life for elderly people.","Elder-care support and community assistance.","Ageing with dignity.","Alandi Road, Pune","020 20265513","","https://www.helpageindia.org/",1],
  ["Roti Bank - Ark Charitable Trust","roti-bank-pune","🍚","A food-support initiative helping connect meals with people who need them.","Reduce food insecurity by redirecting usable food and supporting meal access.","Meal distribution and food-support initiatives.","Pune, Maharashtra","","","",0]
];
const baseRequirements = {
  "akanksha-organization":[["School Bags","education",40,16,"urgent"],["Notebooks","books",80,47,"urgent"],["Clothes","clothes",30,14,"normal"]],
  "akanksha-foundation":[["Notebooks","books",80,47,"urgent"],["School Bags","education",35,22,"normal"],["Art Supplies","education",30,18,"normal"]],
  "spherule-foundation":[["School Bags","education",40,16,"urgent"],["Notebooks","books",100,67,"urgent"],["Stationery Kits","education",50,31,"normal"]],
  "joshconnect-foundation":[["School Kits","education",30,18,"urgent"],["Cycles","education",15,7,"normal"],["Meal Support","food",60,42,"urgent"]],
  "seva-sahayog-foundation":[["Education Kits","education",50,34,"normal"],["Food Kits","food",35,21,"urgent"],["Hygiene Kits","medical",25,16,"normal"]],
  "helpage-india-pune":[["Mobility Aids","medical",15,8,"urgent"],["Nutrition Kits","food",30,19,"normal"],["Hygiene Kits","medical",25,14,"normal"]],
  "roti-bank-pune":[["Meal Support","food",60,42,"urgent"],["Food Packets","food",100,71,"urgent"]]
};
const surveyNGOs = [
  {name:"Jinbhakti Manavseva Balashram",slug:"jinbhakti-manavseva-balashram-survey",icon:"🤝",about:"Profile added from the KindConnect student NGO survey. The respondent estimated that approximately 22 beneficiaries could benefit from donations. The survey reported that shortages of books, stationery and similar essentials are rare.",mission:"Connect community organisations with people willing to contribute useful essential items.",what_they_do:"Survey-reported service area: Pune and Ahmednagar. Specific programmes and current item requirements should be confirmed with the organisation before donations are arranged.",motto:"Community support through useful contributions.",address:"Katraj, Pune, Maharashtra",phone:"",email:null,website:null,verified:0,map_query:"Jinbhakti Manavseva Balashram, Katraj, Pune"},
  {name:"Samsta Balashram",slug:"samsta-balashram-rashingoon-survey",icon:"🤝",about:"Profile added from the KindConnect student NGO survey. The respondent estimated that approximately 30–35 beneficiaries overall could benefit from donations. The survey reported that shortages of books, stationery and similar essentials are rare.",mission:"Help donors discover local organisations and confirm their actual needs.",what_they_do:"Survey-reported service area: Ahmednagar and Pune. Specific programmes and current item requirements should be confirmed with the organisation before donations are arranged.",motto:"Local support, connected responsibly.",address:"Rashingoon, Karjat, Ahmednagar, Maharashtra",phone:"",email:null,website:null,verified:0,map_query:"Samsta Balashram, Rashingoon, Karjat, Ahmednagar"},
  {name:"Nandanvan Old Age Home",slug:"nandanvan-old-age-home-bibwewadi-survey",icon:"❤️",about:"An old-age home in Bibwewadi, Pune. The KindConnect student survey recorded approximately 23 beneficiaries and reported occasional shortages of books, stationery or similar essentials.",mission:"Support the wellbeing of older people by helping donors connect with local care organisations.",what_they_do:"Elder-care organisation based in Bibwewadi, Pune. The survey indicated that donations are sourced through personal contacts and corporate CSR partnerships. Please confirm specific current needs directly before donating.",motto:"Care and dignity for older people.",address:"Bibwewadi, Pune, Maharashtra 411046",phone:"",email:null,website:null,verified:0,map_query:"Nandanvan Old Age Home, Bibwewadi, Pune 411046"}
];

async function initDatabase() {
  await pool.query(schema);
  const { rows: countRows } = await pool.query("SELECT COUNT(*)::int AS c FROM ngos");
  if (countRows[0].c === 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of baseNGOs) {
        const [name,slug,icon,about,mission,what_they_do,motto,address,phone,email,website,verified] = r;
        await client.query(`INSERT INTO ngos(name,slug,icon,about,mission,what_they_do,motto,address,phone,email,website,verified,map_query)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(slug) DO NOTHING`,
          [name,slug,icon,about,mission,what_they_do,motto,address,phone,email || null,website || null,verified,`${name}, ${address}`]);
      }
      for (const [slug, items] of Object.entries(baseRequirements)) {
        const ngoResult = await client.query("SELECT id FROM ngos WHERE slug=$1", [slug]);
        if (!ngoResult.rows[0]) continue;
        for (const item of items) {
          const already = await client.query("SELECT id FROM requirements WHERE ngo_id=$1 AND item=$2", [ngoResult.rows[0].id,item[0]]);
          if (!already.rows[0]) await client.query("INSERT INTO requirements(ngo_id,item,category,needed,fulfilled,urgency) VALUES($1,$2,$3,$4,$5,$6)", [ngoResult.rows[0].id,...item]);
        }
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  }
  for (const ngo of surveyNGOs) {
    await pool.query(`INSERT INTO ngos(name,slug,icon,about,mission,what_they_do,motto,address,phone,email,website,verified,map_query)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(slug) DO NOTHING`,
      [ngo.name,ngo.slug,ngo.icon,ngo.about,ngo.mission,ngo.what_they_do,ngo.motto,ngo.address,ngo.phone,ngo.email,ngo.website,ngo.verified,ngo.map_query]);
  }
}

function requireAuth(req,res,next) {
  if (!req.session.user) return res.status(401).json({error:"Please log in first."});
  next();
}
function requireRole(role) {
  return (req,res,next) => {
    if (!req.session.user || req.session.user.role !== role) return res.status(403).json({error:"This action is not available for your account."});
    next();
  };
}
function publicUser(user) { return {id:user.id,name:user.name,email:user.email,role:user.role}; }
function asyncRoute(handler) { return (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next); }

app.get("/api/health", (req,res) => res.json({ok:true,service:"KindConnect API"}));
app.get("/api/auth/me", (req,res) => res.json({user:req.session.user ? publicUser(req.session.user) : null}));

app.post("/api/auth/register", asyncRoute(async (req,res) => {
  const name=String(req.body.name||"").trim();
  const email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  const role=String(req.body.role||"donor").trim().toLowerCase();
  if (!name||!email||!password) return res.status(400).json({error:"Name, email and password are required."});
  if (password.length<6) return res.status(400).json({error:"Password must contain at least 6 characters."});
  if (!["donor","ngo"].includes(role)) return res.status(400).json({error:"Invalid account type."});
  const hash=await bcrypt.hash(password,12);
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const existing=await client.query("SELECT id FROM users WHERE lower(email)=$1",[email]);
    if (existing.rows[0]) { await client.query("ROLLBACK"); return res.status(409).json({error:"An account with this email already exists. Please log in instead."}); }
    const userResult=await client.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *",[name,email,hash,role]);
    const user=userResult.rows[0];
    if (role==="ngo") {
      const baseSlug=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||`ngo-${user.id}`;
      let slug=baseSlug, suffix=2;
      while ((await client.query("SELECT id FROM ngos WHERE slug=$1",[slug])).rows[0]) slug=`${baseSlug}-${suffix++}`;
      await client.query(`INSERT INTO ngos(owner_user_id,name,slug,icon,about,mission,what_they_do,motto,address,phone,email,website,verified,map_query)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13)`,[user.id,name,slug,"🤝","Community organisation profile. Update this information from your NGO workspace.","Connect donors with the people and causes your organisation serves.","Add your current donation requirements and connect with donors through KindConnect.","Small acts. Real impact.","Pune, Maharashtra","",email,"",`${name}, Pune, Maharashtra`]);
    }
    await client.query("COMMIT");
    req.session.user=user;
    res.status(201).json({user:publicUser(user)});
  } catch (e) { await client.query("ROLLBACK"); if (e.code==="23505") return res.status(409).json({error:"An account with this email or NGO slug already exists."}); throw e; }
  finally { client.release(); }
}));

app.post("/api/auth/login", asyncRoute(async (req,res) => {
  const email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  const result=await pool.query("SELECT * FROM users WHERE email=$1",[email]);
  const user=result.rows[0];
  if (!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:"Invalid email or password."});
  req.session.user=user;
  res.json({user:publicUser(user)});
}));
app.post("/api/auth/logout", (req,res) => req.session.destroy(() => res.json({ok:true})));

app.get("/api/ngos", asyncRoute(async (req,res) => {
  const q=String(req.query.q||"").trim().toLowerCase();
  const category=String(req.query.category||"").trim().toLowerCase();
  const result=await pool.query(`SELECT n.id,n.name,n.slug,n.icon,n.about,n.mission,n.what_they_do,n.motto,n.address,n.phone,n.email,n.website,n.verified,n.map_query,
    COALESCE(SUM(r.needed),0)::int AS total_needed,COALESCE(SUM(r.fulfilled),0)::int AS total_fulfilled
    FROM ngos n LEFT JOIN requirements r ON r.ngo_id=n.id GROUP BY n.id ORDER BY n.verified DESC,n.name ASC`);
  let rows=result.rows;
  if(q) rows=rows.filter(n=>[n.name,n.address,n.about,n.what_they_do].join(" ").toLowerCase().includes(q));
  if(category) { const matching=await pool.query("SELECT DISTINCT ngo_id FROM requirements WHERE lower(category)=$1",[category]); const ids=new Set(matching.rows.map(x=>x.ngo_id)); rows=rows.filter(n=>ids.has(n.id)); }
  res.json(rows);
}));
app.get("/api/ngos/:id", asyncRoute(async (req,res) => {
  const result=await pool.query("SELECT * FROM ngos WHERE id::text=$1 OR slug=$1 LIMIT 1",[String(req.params.id)]);
  const ngo=result.rows[0];
  if(!ngo) return res.status(404).json({error:"NGO not found."});
  ngo.requirements=(await pool.query("SELECT * FROM requirements WHERE ngo_id=$1 ORDER BY CASE WHEN urgency='urgent' THEN 0 ELSE 1 END,item",[ngo.id])).rows;
  res.json(ngo);
}));
app.get("/api/requirements", asyncRoute(async (req,res) => {
  const result=await pool.query(`SELECT r.id,r.ngo_id,r.item,r.category,r.needed,r.fulfilled,r.urgency,n.name AS ngo_name,n.slug AS ngo_slug,n.address
    FROM requirements r JOIN ngos n ON n.id=r.ngo_id WHERE r.fulfilled<r.needed
    ORDER BY CASE WHEN r.urgency='urgent' THEN 0 ELSE 1 END,(r.needed-r.fulfilled) DESC`);
  res.json(result.rows);
}));

app.post("/api/pledges", requireAuth, requireRole("donor"), asyncRoute(async (req,res) => {
  const requirementId=Number(req.body.requirement_id), quantity=Number(req.body.quantity);
  if(!Number.isInteger(requirementId)||!Number.isInteger(quantity)||quantity<1) return res.status(400).json({error:"Requirement and a positive quantity are required."});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const rr=await client.query("SELECT * FROM requirements WHERE id=$1 FOR UPDATE",[requirementId]);
    const requirement=rr.rows[0];
    if(!requirement) { await client.query("ROLLBACK"); return res.status(404).json({error:"Requirement not found."}); }
    if(quantity>requirement.needed-requirement.fulfilled) { await client.query("ROLLBACK"); return res.status(400).json({error:"That quantity is greater than the remaining need."}); }
    const pledge=await client.query("INSERT INTO pledges(donor_id,requirement_id,quantity) VALUES($1,$2,$3) RETURNING id",[req.session.user.id,requirementId,quantity]);
    await client.query("UPDATE requirements SET fulfilled=fulfilled+$1 WHERE id=$2",[quantity,requirementId]);
    await client.query("COMMIT");
    res.status(201).json({ok:true,pledge_id:pledge.rows[0].id});
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}));
app.get("/api/donor/dashboard", requireAuth, requireRole("donor"), asyncRoute(async (req,res) => {
  const pledges=(await pool.query(`SELECT p.id,p.quantity,p.status,p.created_at,r.item,r.category,n.id AS ngo_id,n.name AS ngo_name,n.address
    FROM pledges p JOIN requirements r ON r.id=p.requirement_id JOIN ngos n ON n.id=r.ngo_id WHERE p.donor_id=$1 ORDER BY p.created_at DESC`,[req.session.user.id])).rows;
  res.json({user:publicUser(req.session.user),total_items_helped:pledges.reduce((a,p)=>a+p.quantity,0),pledges});
}));

async function getOrCreateOwnedNgo(user) {
  let result=await pool.query("SELECT * FROM ngos WHERE owner_user_id=$1",[user.id]);
  if(result.rows[0]) return result.rows[0];
  const baseName=(user.name||"My NGO").trim()||"My NGO";
  const baseSlug=baseName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||`ngo-${user.id}`;
  let slug=baseSlug,suffix=2;
  while((await pool.query("SELECT id FROM ngos WHERE slug=$1",[slug])).rows[0]) slug=`${baseSlug}-${suffix++}`;
  const inserted=await pool.query(`INSERT INTO ngos(owner_user_id,name,slug,icon,about,mission,what_they_do,motto,address,phone,email,website,verified,map_query)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13) RETURNING *`,[user.id,baseName,slug,"🤝","Community organisation profile. Update this information from your NGO workspace.","Connect donors with the people and causes your organisation serves.","Add your current donation requirements and connect with donors through KindConnect.","Small acts. Real impact.","Pune, Maharashtra","",user.email||"","",`${baseName}, Pune, Maharashtra`]);
  return inserted.rows[0];
}
app.get("/api/ngo/dashboard", requireAuth, requireRole("ngo"), asyncRoute(async (req,res) => {
  const ngo=await getOrCreateOwnedNgo(req.session.user);
  const requirements=(await pool.query("SELECT * FROM requirements WHERE ngo_id=$1 ORDER BY created_at DESC",[ngo.id])).rows;
  const pledges=(await pool.query(`SELECT p.id,p.quantity,p.status,p.created_at,r.item,u.name AS donor_name FROM pledges p JOIN requirements r ON r.id=p.requirement_id JOIN users u ON u.id=p.donor_id WHERE r.ngo_id=$1 ORDER BY p.created_at DESC`,[ngo.id])).rows;
  res.json({ngo,requirements,pledges});
}));
app.patch("/api/ngo/profile", requireAuth, requireRole("ngo"), asyncRoute(async (req,res) => {
  const {name,about,mission,what_they_do,motto,address,phone,email,website,icon}=req.body;
  if(!name||!about||!mission||!what_they_do||!motto||!address||!phone) return res.status(400).json({error:"Required NGO profile fields are missing."});
  const slug=String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const exists=(await pool.query("SELECT id FROM ngos WHERE owner_user_id=$1",[req.session.user.id])).rows[0];
  if(exists) {
    await pool.query(`UPDATE ngos SET name=$1,about=$2,mission=$3,what_they_do=$4,motto=$5,address=$6,phone=$7,email=$8,website=$9,icon=$10,map_query=$11 WHERE owner_user_id=$12`,[name,about,mission,what_they_do,motto,address,phone,email||"",website||"",icon||"🤝",`${name}, ${address}`,req.session.user.id]);
    const saved=(await pool.query("SELECT * FROM ngos WHERE owner_user_id=$1",[req.session.user.id])).rows[0];
    return res.json({ok:true,ngo:saved});
  }
  try {
    const inserted=await pool.query(`INSERT INTO ngos(owner_user_id,name,slug,icon,about,mission,what_they_do,motto,address,phone,email,website,verified,map_query)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13) RETURNING *`,[req.session.user.id,name,slug,icon||"🤝",about,mission,what_they_do,motto,address,phone,email||"",website||"",`${name}, ${address}`]);
    res.status(201).json({ok:true,message:"NGO profile published successfully.",ngo:inserted.rows[0]});
  } catch(e) { if(e.code==="23505") return res.status(409).json({error:"An NGO with that name already exists."}); throw e; }
}));
app.post("/api/ngo/requirements", requireAuth, requireRole("ngo"), asyncRoute(async (req,res) => {
  const ngo=await getOrCreateOwnedNgo(req.session.user);
  const {item,category="general",needed,urgency="normal",unit="",notes=""}=req.body;
  const cleanItem=String(item||"").trim(), cleanCategory=String(category||"general").trim().toLowerCase()||"general", qty=Number(needed), cleanUrgency=urgency==="urgent"?"urgent":"normal";
  if(!cleanItem||!Number.isInteger(qty)||qty<1) return res.status(400).json({error:"Item and a positive quantity are required."});
  const result=await pool.query("INSERT INTO requirements(ngo_id,item,category,needed,fulfilled,urgency,unit,notes) VALUES($1,$2,$3,$4,0,$5,$6,$7) RETURNING id",[ngo.id,cleanItem,cleanCategory,qty,cleanUrgency,String(unit||"").trim(),String(notes||"").trim()]);
  res.status(201).json({ok:true,id:result.rows[0].id,message:"Requirement published."});
}));
app.patch("/api/ngo/requirements/:id", requireAuth, requireRole("ngo"), asyncRoute(async (req,res) => {
  const ngo=await getOrCreateOwnedNgo(req.session.user);
  const result=await pool.query("SELECT * FROM requirements WHERE id=$1",[req.params.id]);
  const r=result.rows[0];
  if(!r||r.ngo_id!==ngo.id) return res.status(404).json({error:"Requirement not found."});
  const item=req.body.item===undefined?r.item:String(req.body.item||"").trim();
  const category=req.body.category===undefined?r.category:String(req.body.category||"general").trim().toLowerCase();
  const needed=req.body.needed===undefined?r.needed:Number(req.body.needed);
  const urgency=req.body.urgency===undefined?r.urgency:(req.body.urgency==="urgent"?"urgent":"normal");
  const unit=req.body.unit===undefined?(r.unit||""):String(req.body.unit||"").trim();
  const notes=req.body.notes===undefined?(r.notes||""):String(req.body.notes||"").trim();
  if(!item||!Number.isInteger(needed)||needed<r.fulfilled) return res.status(400).json({error:"Invalid item or quantity. Needed cannot be below fulfilled quantity."});
  await pool.query("UPDATE requirements SET item=$1,category=$2,needed=$3,urgency=$4,unit=$5,notes=$6 WHERE id=$7",[item,category,needed,urgency,unit,notes,r.id]);
  res.json({ok:true});
}));
app.delete("/api/ngo/requirements/:id", requireAuth, requireRole("ngo"), asyncRoute(async (req,res) => {
  const ngo=await getOrCreateOwnedNgo(req.session.user);
  const result=await pool.query("SELECT * FROM requirements WHERE id=$1",[req.params.id]);
  const r=result.rows[0];
  if(!ngo||!r||r.ngo_id!==ngo.id) return res.status(404).json({error:"Requirement not found."});
  await pool.query("DELETE FROM requirements WHERE id=$1",[r.id]);
  res.json({ok:true});
}));

app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next)=>{ console.error("KindConnect request error:",err); if(res.headersSent) return next(err); res.status(500).json({error:"An unexpected server error occurred."}); });

async function start() {
  try {
    await initDatabase();
    app.listen(PORT,()=>console.log(`KindConnect backend listening on port ${PORT}`));
  } catch (err) {
    console.error("Failed to initialise KindConnect PostgreSQL database:",err);
    process.exit(1);
  }
}
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
start();
