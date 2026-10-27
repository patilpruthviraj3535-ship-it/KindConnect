

const path = require("path");

const express = require("express");

const session = require("express-session");

const bcrypt = require("bcryptjs");

const Database = require("better-sqlite3");

const app = express();

const PORT = process.env.PORT || 3000;

const db = new Database(path.join(__dirname, "kindconnect.db"));

db.pragma("journal_mode = WAL");

db.pragma("foreign_keys = ON");

db.exec(`

CREATE TABLE IF NOT EXISTS users (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL,

  email TEXT NOT NULL UNIQUE,

  password_hash TEXT NOT NULL,

  role TEXT NOT NULL CHECK(role IN ('donor','ngo','admin')),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

);

CREATE TABLE IF NOT EXISTS ngos (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  owner_user_id INTEGER REFERENCES users(id),

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

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

);

CREATE TABLE IF NOT EXISTS requirements (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  ngo_id INTEGER NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,

  item TEXT NOT NULL,

  category TEXT NOT NULL,

  needed INTEGER NOT NULL CHECK(needed >= 0),

  fulfilled INTEGER NOT NULL DEFAULT 0 CHECK(fulfilled >= 0),

  urgency TEXT NOT NULL DEFAULT 'normal' CHECK(urgency IN ('normal','urgent')),

  unit TEXT NOT NULL DEFAULT '',

  notes TEXT NOT NULL DEFAULT '',

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

);

CREATE TABLE IF NOT EXISTS pledges (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  donor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  requirement_id INTEGER NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,

  quantity INTEGER NOT NULL CHECK(quantity > 0),

  status TEXT NOT NULL DEFAULT 'pledged' CHECK(status IN ('pledged','confirmed','completed','cancelled')),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

);

`);

// Backward-compatible migrations for databases created by older KindConnect versions.
try { db.exec(`ALTER TABLE requirements ADD COLUMN unit TEXT NOT NULL DEFAULT ''`); } catch (e) {}
try { db.exec(`ALTER TABLE requirements ADD COLUMN notes TEXT NOT NULL DEFAULT ''`); } catch (e) {}

// Migration for older KindConnect databases.
// Older NGO tables may not have owner_user_id; NGO accounts need this
// column so every NGO can edit only its own organisation.
try { db.exec(`ALTER TABLE ngos ADD COLUMN owner_user_id INTEGER`); } catch (e) {}

function seedNGOs(){

  const count = db.prepare("SELECT COUNT(*) AS c FROM ngos").get().c;

  if (count) return;

  const rows = [

    ["Akanksha Organization","akanksha-organization","🎓","Education-focused community support organisation.","Empower children and young adults through high-quality education.","Schools, education support, learning resources and student wellbeing.","Be the Change.","Erandwane, Pune","+91 20 6605 1380","fundraise@akanksha.org","https://akanksha.org/",1],

    ["Akanksha Foundation","akanksha-foundation","📚","A nonprofit focused on holistic education for children and young adults from underserved communities.","Build high-performing and innovative schools and empower students.","Education, life skills, sports, arts and student wellbeing.","Be the Change.","Wakadewadi, Pune","+91 20 6605 1380","fundraise@akanksha.org","https://akanksha.org/",1],

    ["Spherule Foundation","spherule-foundation","🎒","A Pune-based organisation working on practical community and education support.","Connect useful resources with people and communities who need them.","Education and community support including school supplies and essential goods.","Make every contribution useful.","Viman Nagar, Pune","+91 7276021861","","https://spherule.org/",1],

    ["JOSHConnect Foundation","joshconnect-foundation","🎒","A community-focused organisation connecting people with practical support initiatives.","Create meaningful community impact by connecting resources with people who need them.","Education, livelihood and essential-support initiatives.","Connect resources. Create change.","Kharadi, Pune","+91 9359876467","","https://www.joshconnect.org/",1],

    ["Seva Sahayog Foundation","seva-sahayog-foundation","🤲","A Pune community organisation supporting people through education, food and essential goods.","Strengthen communities through service and practical support.","Community essentials, education and support programmes.","Seva through community.","Navi Peth, Pune","020 24537655","","https://sevasahayog.org/",1],

    ["Helpage India","helpage-india-pune","❤️","An organisation working to support older people and their wellbeing.","Enable a dignified and secure life for elderly people.","Elder-care support and community assistance.","Ageing with dignity.","Alandi Road, Pune","020 20265513","","https://www.helpageindia.org/",1],

    ["Roti Bank - Ark Charitable Trust","roti-bank-pune","🍚","A food-support initiative helping connect meals with people who need them.","Reduce food insecurity by redirecting usable food and supporting meal access.","Meal distribution and food-support initiatives.","Pune, Maharashtra","","","","",0]

  ];

  const insert = db.prepare(`

    INSERT INTO ngos

    (name,slug,icon,about,mission,what_they_do,motto,address,phone,email,website,verified,map_query)

    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)

  `);

  const add = db.transaction(() => {

    for (const r of rows) {

      const mapQuery = `${r[0]}, ${r[7]}`;

      insert.run(...r, mapQuery);

    }

  });

  add();

  const getNgo = db.prepare("SELECT id,name FROM ngos WHERE slug=?");

  const addReq = db.prepare(`

    INSERT INTO requirements(ngo_id,item,category,needed,fulfilled,urgency)

    VALUES(?,?,?,?,?,?)

  `);

  const reqs = {

    "akanksha-organization":[["School Bags","education",40,16,"urgent"],["Notebooks","books",80,47,"urgent"],["Clothes","clothes",30,14,"normal"]],

    "akanksha-foundation":[["Notebooks","books",80,47,"urgent"],["School Bags","education",35,22,"normal"],["Art Supplies","education",30,18,"normal"]],

    "spherule-foundation":[["School Bags","education",40,16,"urgent"],["Notebooks","books",100,67,"urgent"],["Stationery Kits","education",50,31,"normal"]],

    "joshconnect-foundation":[["School Kits","education",30,18,"urgent"],["Cycles","education",15,7,"normal"],["Meal Support","food",60,42,"urgent"]],

    "seva-sahayog-foundation":[["Education Kits","education",50,34,"normal"],["Food Kits","food",35,21,"urgent"],["Hygiene Kits","medical",25,16,"normal"]],

    "helpage-india-pune":[["Mobility Aids","medical",15,8,"urgent"],["Nutrition Kits","food",30,19,"normal"],["Hygiene Kits","medical",25,14,"normal"]],

    "roti-bank-pune":[["Meal Support","food",60,42,"urgent"],["Food Packets","food",100,71,"urgent"]]

  };

  const tx = db.transaction(() => {

    for (const [slug, items] of Object.entries(reqs)) {

      const ngo = getNgo.get(slug);

      if (!ngo) continue;

      for (const item of items) addReq.run(ngo.id,...item);

    }

  });

  tx();

}

seedNGOs();

// Survey-based NGO profiles. These are deliberately unverified and do not
// publish survey respondents' personal phone numbers or email addresses.
// Insert each profile once, without replacing existing NGO records.
function seedSurveyNGOs(){
  const rows = [
    {
      name: "Jinbhakti Manavseva Balashram",
      slug: "jinbhakti-manavseva-balashram-survey",
      icon: "🤝",
      about: "Profile added from the KindConnect student NGO survey. The respondent estimated that approximately 22 beneficiaries could benefit from donations. The survey reported that shortages of books, stationery and similar essentials are rare.",
      mission: "Connect community organisations with people willing to contribute useful essential items.",
      what_they_do: "Survey-reported service area: Pune and Ahmednagar. Specific programmes and current item requirements should be confirmed with the organisation before donations are arranged.",
      motto: "Community support through useful contributions.",
      address: "Katraj, Pune, Maharashtra",
      phone: "",
      email: null,
      website: null,
      verified: 0,
      map_query: "Jinbhakti Manavseva Balashram, Katraj, Pune"
    },
    {
      name: "Samsta Balashram",
      slug: "samsta-balashram-rashingoon-survey",
      icon: "🤝",
      about: "Profile added from the KindConnect student NGO survey. The respondent estimated that approximately 30–35 beneficiaries overall could benefit from donations. The survey reported that shortages of books, stationery and similar essentials are rare.",
      mission: "Help donors discover local organisations and confirm their actual needs.",
      what_they_do: "Survey-reported service area: Ahmednagar and Pune. Specific programmes and current item requirements should be confirmed with the organisation before donations are arranged.",
      motto: "Local support, connected responsibly.",
      address: "Rashingoon, Karjat, Ahmednagar, Maharashtra",
      phone: "",
      email: null,
      website: null,
      verified: 0,
      map_query: "Samsta Balashram, Rashingoon, Karjat, Ahmednagar"
    },
    {
      name: "Nandanvan Old Age Home",
      slug: "nandanvan-old-age-home-bibwewadi-survey",
      icon: "❤️",
      about: "An old-age home in Bibwewadi, Pune. The KindConnect student survey recorded approximately 23 beneficiaries and reported occasional shortages of books, stationery or similar essentials.",
      mission: "Support the wellbeing of older people by helping donors connect with local care organisations.",
      what_they_do: "Elder-care organisation based in Bibwewadi, Pune. The survey indicated that donations are sourced through personal contacts and corporate CSR partnerships. Please confirm specific current needs directly before donating.",
      motto: "Care and dignity for older people.",
      address: "Bibwewadi, Pune, Maharashtra 411046",
      phone: "",
      email: null,
      website: null,
      verified: 0,
      map_query: "Nandanvan Old Age Home, Bibwewadi, Pune 411046"
    }
  ];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ngos
      (name,slug,icon,about,mission,what_they_do,motto,address,phone,email,website,verified,map_query)
    VALUES (@name,@slug,@icon,@about,@mission,@what_they_do,@motto,@address,@phone,@email,@website,@verified,@map_query)
  `);
  const add = db.transaction(() => rows.forEach(row => insert.run(row)));
  add();
}
seedSurveyNGOs();

app.use(express.json({limit:"1mb"}));

app.use(express.urlencoded({extended:true}));

app.use(session({

  secret: process.env.SESSION_SECRET || "kindconnect-dev-secret-change-me",

  resave:false,

  saveUninitialized:false,

  cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:1000*60*60*24*7}

}));

function requireAuth(req,res,next){

  if(!req.session.user) return res.status(401).json({error:"Please log in first."});

  next();

}

function requireRole(role){

  return (req,res,next)=>{

    if(!req.session.user || req.session.user.role !== role)

      return res.status(403).json({error:"This action is not available for your account."});

    next();

  };

}

function publicUser(user){

  return {id:user.id,name:user.name,email:user.email,role:user.role};

}

app.get("/api/health",(req,res)=>res.json({ok:true,service:"KindConnect API"}));

app.get("/api/auth/me",(req,res)=>{

  res.json({user:req.session.user ? publicUser(req.session.user) : null});

});

app.post("/api/auth/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "donor").trim().toLowerCase();

  if (!name || !email || !password) {
    return res.status(400).json({
      error: "Name, email and password are required."
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      error: "Password must contain at least 6 characters."
    });
  }

  if (!["donor", "ngo"].includes(role)) {
    return res.status(400).json({
      error: "Invalid account type."
    });
  }

  try {
    const existing = db.prepare(
      "SELECT id FROM users WHERE lower(email)=?"
    ).get(email);

    if (existing) {
      return res.status(409).json({
        error: "An account with this email already exists. Please log in instead."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const transaction = db.transaction(() => {
      const userResult = db.prepare(`
        INSERT INTO users(name,email,password_hash,role)
        VALUES(?,?,?,?)
      `).run(name, email, hash, role);

      const user = db.prepare(
        "SELECT * FROM users WHERE id=?"
      ).get(userResult.lastInsertRowid);

      if (role === "ngo") {
        const baseSlug =
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") ||
          `ngo-${user.id}`;

        let slug = baseSlug;
        let suffix = 2;

        while (
          db.prepare(
            "SELECT id FROM ngos WHERE slug=?"
          ).get(slug)
        ) {
          slug = `${baseSlug}-${suffix++}`;
        }

        db.prepare(`
          INSERT INTO ngos(
            owner_user_id,
            name,
            slug,
            icon,
            about,
            mission,
            what_they_do,
            motto,
            address,
            phone,
            email,
            website,
            verified,
            map_query
          )
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?)
        `).run(
          user.id,
          name,
          slug,
          "🤝",
          "Community organisation profile. Update this information from your NGO workspace.",
          "Connect donors with the people and causes your organisation serves.",
          "Add your current donation requirements and connect with donors through KindConnect.",
          "Small acts. Real impact.",
          "Pune, Maharashtra",
          "",
          email,
          "",
          `${name}, Pune, Maharashtra`
        );
      }

      return user;
    });

    const user = transaction();

    req.session.user = user;

    res.status(201).json({
      user: publicUser(user)
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);

    return res.status(500).json({
      error: "Account creation failed. Check the server terminal for the exact error."
    });
  }
});

app.post("/api/auth/login",async(req,res)=>{

  const email=(req.body.email||"").trim().toLowerCase();

  const password=req.body.password||"";

  const user=db.prepare("SELECT * FROM users WHERE email=?").get(email);

  if(!user || !(await bcrypt.compare(password,user.password_hash)))

    return res.status(401).json({error:"Invalid email or password."});

  req.session.user=user;

  res.json({user:publicUser(user)});

});

app.post("/api/auth/logout",(req,res)=>{

  req.session.destroy(()=>res.json({ok:true}));

});

app.get("/api/ngos",(req,res)=>{

  const q=(req.query.q||"").trim().toLowerCase();

  const category=(req.query.category||"").trim().toLowerCase();

  let rows=db.prepare(`

    SELECT n.id,n.name,n.slug,n.icon,n.about,n.mission,n.what_they_do,n.motto,

           n.address,n.phone,n.email,n.website,n.verified,n.map_query,

           COALESCE(SUM(r.needed),0) AS total_needed,

           COALESCE(SUM(r.fulfilled),0) AS total_fulfilled

    FROM ngos n

    LEFT JOIN requirements r ON r.ngo_id=n.id

    GROUP BY n.id

    ORDER BY n.verified DESC,n.name ASC

  `).all();

  if(q){

    rows=rows.filter(n =>

      [n.name,n.address,n.about,n.what_they_do].join(" ").toLowerCase().includes(q)

    );

  }

  if(category){

    const matching=db.prepare(`

      SELECT DISTINCT ngo_id FROM requirements WHERE lower(category)=?

    `).all(category).map(x=>x.ngo_id);

    rows=rows.filter(n=>matching.includes(n.id));

  }

  res.json(rows);

});

app.get("/api/ngos/:id",(req,res)=>{

  const ngo=db.prepare("SELECT * FROM ngos WHERE id=? OR slug=?").get(req.params.id,req.params.id);

  if(!ngo) return res.status(404).json({error:"NGO not found."});

  ngo.requirements=db.prepare(`

    SELECT * FROM requirements

    WHERE ngo_id=?

    ORDER BY CASE WHEN urgency='urgent' THEN 0 ELSE 1 END,item

  `).all(ngo.id);

  res.json(ngo);

});

app.get("/api/requirements",(req,res)=>{

  const rows=db.prepare(`

    SELECT r.id,r.ngo_id,r.item,r.category,r.needed,r.fulfilled,r.urgency,

           n.name AS ngo_name,n.slug AS ngo_slug,n.address

    FROM requirements r JOIN ngos n ON n.id=r.ngo_id

    WHERE r.fulfilled < r.needed

    ORDER BY CASE WHEN r.urgency='urgent' THEN 0 ELSE 1 END,

             (r.needed-r.fulfilled) DESC

  `).all();

  res.json(rows);

});

app.post("/api/pledges",requireAuth,requireRole("donor"),(req,res)=>{

  const requirementId=Number(req.body.requirement_id);

  const quantity=Number(req.body.quantity);

  if(!Number.isInteger(requirementId) || !Number.isInteger(quantity) || quantity<1)

    return res.status(400).json({error:"Requirement and a positive quantity are required."});

  const tx=db.transaction(()=>{

    const requirement=db.prepare("SELECT * FROM requirements WHERE id=?").get(requirementId);

    if(!requirement) throw new Error("REQUIREMENT_NOT_FOUND");

    const remaining=requirement.needed-requirement.fulfilled;

    if(quantity>remaining) throw new Error("QUANTITY_TOO_HIGH");

    const pledge=db.prepare(`

      INSERT INTO pledges(donor_id,requirement_id,quantity)

      VALUES(?,?,?)

    `).run(req.session.user.id,requirementId,quantity);

    db.prepare(`

      UPDATE requirements SET fulfilled=fulfilled+? WHERE id=?

    `).run(quantity,requirementId);

    return pledge.lastInsertRowid;

  });

  try{

    res.status(201).json({ok:true,pledge_id:tx()});

  }catch(e){

    if(e.message==="REQUIREMENT_NOT_FOUND") return res.status(404).json({error:"Requirement not found."});

    if(e.message==="QUANTITY_TOO_HIGH") return res.status(400).json({error:"That quantity is greater than the remaining need."});

    res.status(500).json({error:"Could not record the pledge."});

  }

});

app.get("/api/donor/dashboard",requireAuth,requireRole("donor"),(req,res)=>{

  const pledges=db.prepare(`

    SELECT p.id,p.quantity,p.status,p.created_at,

           r.item,r.category,

           n.id AS ngo_id,n.name AS ngo_name,n.address

    FROM pledges p

    JOIN requirements r ON r.id=p.requirement_id

    JOIN ngos n ON n.id=r.ngo_id

    WHERE p.donor_id=?

    ORDER BY p.created_at DESC

  `).all(req.session.user.id);

  const total=pledges.reduce((a,p)=>a+p.quantity,0);

  res.json({user:publicUser(req.session.user),total_items_helped:total,pledges});

});

app.patch("/api/ngo/profile",requireAuth,requireRole("ngo"),(req,res)=>{

  const {name,about,mission,what_they_do,motto,address,phone,email,website,icon}=req.body;

  if(!name||!about||!mission||!what_they_do||!motto||!address||!phone)

    return res.status(400).json({error:"Required NGO profile fields are missing."});

  const slug=name.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

  const exists=db.prepare("SELECT id FROM ngos WHERE owner_user_id=?").get(req.session.user.id);

  if(exists){

    db.prepare(`

      UPDATE ngos SET name=?,about=?,mission=?,what_they_do=?,motto=?,address=?,

      phone=?,email=?,website=?,icon=?,map_query=? WHERE owner_user_id=?

    `).run(name,about,mission,what_they_do,motto,address,phone,email||"",website||"",icon||"🤝",

      `${name}, ${address}`,req.session.user.id);

    const saved=db.prepare("SELECT * FROM ngos WHERE owner_user_id=?").get(req.session.user.id);
    return res.json({ok:true,ngo:saved});

  }

  try{

    db.prepare(`

      INSERT INTO ngos(owner_user_id,name,slug,icon,about,mission,what_they_do,motto,

      address,phone,email,website,verified,map_query)

      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?)

    `).run(req.session.user.id,name,slug,icon||"🤝",about,mission,what_they_do,motto,address,

      phone,email||"",website||"",`${name}, ${address}`);

    const saved=db.prepare("SELECT * FROM ngos WHERE owner_user_id=?").get(req.session.user.id);
    res.status(201).json({ok:true,message:"NGO profile published successfully.",ngo:saved});

  }catch(e){

    res.status(409).json({error:"An NGO with that name already exists."});

  }

});

function getOrCreateOwnedNgo(user){
  let ngo=db.prepare("SELECT * FROM ngos WHERE owner_user_id=?").get(user.id);
  if(ngo) return ngo;

  const baseName=(user.name||"My NGO").trim() || "My NGO";
  const baseSlug=baseName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || ("ngo-"+user.id);
  let slug=baseSlug, suffix=2;
  while(db.prepare("SELECT id FROM ngos WHERE slug=?").get(slug)) slug=baseSlug+"-"+suffix++;

  const result=db.prepare(`
    INSERT INTO ngos(
      owner_user_id,name,slug,icon,about,mission,what_they_do,motto,
      address,phone,email,website,verified,map_query
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?)
  `).run(
    user.id,baseName,slug,"🤝",
    "Community organisation profile. Update this information from your NGO workspace.",
    "Connect donors with the people and causes your organisation serves.",
    "Add your current donation requirements and connect with donors through KindConnect.",
    "Small acts. Real impact.","Pune, Maharashtra","",user.email||"",
    "",`${baseName}, Pune, Maharashtra`
  );
  return db.prepare("SELECT * FROM ngos WHERE id=?").get(result.lastInsertRowid);
}

app.get("/api/ngo/dashboard",requireAuth,requireRole("ngo"),(req,res)=>{

  const ngo=getOrCreateOwnedNgo(req.session.user);

  const requirements=db.prepare("SELECT * FROM requirements WHERE ngo_id=? ORDER BY created_at DESC").all(ngo.id);

  const pledges=db.prepare(`

    SELECT p.id,p.quantity,p.status,p.created_at,r.item,u.name AS donor_name

    FROM pledges p

    JOIN requirements r ON r.id=p.requirement_id

    JOIN users u ON u.id=p.donor_id

    WHERE r.ngo_id=?

    ORDER BY p.created_at DESC

  `).all(ngo.id);

  res.json({ngo,requirements,pledges});

});

app.post("/api/ngo/requirements",requireAuth,requireRole("ngo"),(req,res)=>{
  const ngo=getOrCreateOwnedNgo(req.session.user);
  const {item,category="general",needed,urgency="normal",unit="",notes=""}=req.body;

  const cleanItem=String(item||"").trim();
  const cleanCategory=String(category||"general").trim().toLowerCase() || "general";
  const qty=Number(needed);
  const cleanUrgency=urgency==="urgent" ? "urgent" : "normal";

  if(!cleanItem || !Number.isInteger(qty) || qty<1)
    return res.status(400).json({error:"Item and a positive quantity are required."});

  const result=db.prepare(`
    INSERT INTO requirements(ngo_id,item,category,needed,fulfilled,urgency,unit,notes)
    VALUES(?,?,?,?,0,?,?,?)
  `).run(ngo.id,cleanItem,cleanCategory,qty,cleanUrgency,
         String(unit||"").trim(),String(notes||"").trim());

  res.status(201).json({ok:true,id:result.lastInsertRowid,message:"Requirement published."});
});

app.patch("/api/ngo/requirements/:id",requireAuth,requireRole("ngo"),(req,res)=>{
  const ngo=getOrCreateOwnedNgo(req.session.user);
  const r=db.prepare("SELECT * FROM requirements WHERE id=?").get(req.params.id);

  if(!r || r.ngo_id!==ngo.id)
    return res.status(404).json({error:"Requirement not found."});

  const item=req.body.item===undefined?r.item:String(req.body.item||"").trim();
  const category=req.body.category===undefined?r.category:String(req.body.category||"general").trim().toLowerCase();
  const needed=req.body.needed===undefined?r.needed:Number(req.body.needed);
  const urgency=req.body.urgency===undefined?r.urgency:(req.body.urgency==="urgent"?"urgent":"normal");
  const unit=req.body.unit===undefined?(r.unit||""):String(req.body.unit||"").trim();
  const notes=req.body.notes===undefined?(r.notes||""):String(req.body.notes||"").trim();

  if(!item || !Number.isInteger(needed) || needed<r.fulfilled)
    return res.status(400).json({error:"Invalid item or quantity. Needed cannot be below fulfilled quantity."});

  db.prepare(`
    UPDATE requirements
    SET item=?,category=?,needed=?,urgency=?,unit=?,notes=?
    WHERE id=?
  `).run(item,category,needed,urgency,unit,notes,r.id);

  res.json({ok:true});
});

app.delete("/api/ngo/requirements/:id",requireAuth,requireRole("ngo"),(req,res)=>{

  const ngo=getOrCreateOwnedNgo(req.session.user);

  const r=db.prepare("SELECT * FROM requirements WHERE id=?").get(req.params.id);

  if(!ngo || !r || r.ngo_id!==ngo.id) return res.status(404).json({error:"Requirement not found."});

  db.prepare("DELETE FROM requirements WHERE id=?").run(r.id);

  res.json({ok:true});

});

app.use(express.static(path.join(__dirname,"public")));

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT,()=>console.log(`KindConnect backend running at http://localhost:${PORT}`));try{db.exec(`ALTER TABLE ngos ADD COLUMN avatar_data TEXT NOT NULL DEFAULT ''`);}catch(e){}


