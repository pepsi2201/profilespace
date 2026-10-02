
const session=require("express-session");
const bcrypt=require("bcryptjs");
const Database=require("better-sqlite3");
const multer=require("multer");
const path=require("path");
const fs=require("fs");

const app=express(), PORT=Number(process.env.PORT||3000), HOST=process.env.HOST||"0.0.0.0";
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,"data");
const UPLOAD_DIR=process.env.UPLOAD_DIR||path.join(DATA_DIR,"uploads");
fs.mkdirSync(DATA_DIR,{recursive:true});
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
const db=new Database(path.join(DATA_DIR,"data.sqlite"));
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL,
 nickname TEXT NOT NULL,
 about TEXT DEFAULT '',
 hobbies TEXT DEFAULT '',
 photo TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 text TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS likes(
 user_id INTEGER NOT NULL,
 post_id INTEGER NOT NULL,
 UNIQUE(user_id,post_id)
);
CREATE TABLE IF NOT EXISTS follows(
 follower_id INTEGER NOT NULL,
 following_id INTEGER NOT NULL,
 UNIQUE(follower_id,following_id)
);
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL,
 receiver_id INTEGER NOT NULL,
 text TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);

const upload=multer({storage:multer.diskStorage({
 destination:UPLOAD_DIR,
 filename:(req,file,cb)=>cb(null,Date.now()+"-"+Math.random().toString(36).slice(2)+path.extname(file.originalname))
}),limits:{fileSize:5*1024*1024}});

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.use(session({
 secret:process.env.SESSION_SECRET||"change-this-secret",
 resave:false,saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*24*60*60*1000}
}));
app.use(express.static(path.join(__dirname,"public")));
app.use("/uploads",express.static(UPLOAD_DIR));

function auth(req,res,next){if(!req.session.userId)return res.status(401).json({error:"Необходим вход"});next()}
function safeUser(row){return {id:row.id,email:row.email,nickname:row.nickname,about:row.about,hobbies:row.hobbies?row.hobbies.split(",").filter(Boolean):[],photo:row.photo}}
function current(req){return db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId)}

app.post("/api/register",async(req,res)=>{
 const {email,password,nickname}=req.body;
 if(!email||!password||!nickname)return res.status(400).json({error:"Заполни email, пароль и никнейм"});
 if(password.length<6)return res.status(400).json({error:"Пароль должен быть не короче 6 символов"});
 if(db.prepare("SELECT id FROM users WHERE email=?").get(email.trim().toLowerCase()))return res.status(409).json({error:"Такой email уже зарегистрирован"});
 const hash=await bcrypt.hash(password,12);
 const info=db.prepare("INSERT INTO users(email,password,nickname) VALUES(?,?,?)").run(email.trim().toLowerCase(),hash,nickname.trim());
 req.session.userId=info.lastInsertRowid;
 res.json({user:safeUser(current(req))});
});
app.post("/api/login",async(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email||"").trim().toLowerCase());
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password)))return res.status(401).json({error:"Неверный email или пароль"});
 req.session.userId=u.id;res.json({user:safeUser(u)});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/health",(req,res)=>res.json({ok:true}));
app.get("/api/me",(req,res)=>{const u=current(req);res.json({user:u?safeUser(u):null})});

app.put("/api/profile",auth,upload.single("photo"),(req,res)=>{
 const u=current(req), {nickname,about,hobbies}=req.body;
 if(!nickname?.trim())return res.status(400).json({error:"Никнейм обязателен"});
 let photo=u.photo;
 if(req.file)photo="/uploads/"+req.file.filename;
 db.prepare("UPDATE users SET nickname=?,about=?,hobbies=?,photo=? WHERE id=?")
   .run(nickname.trim(),about||"",hobbies||"",photo,u.id);
 res.json({user:safeUser(current(req))});
});

app.post("/api/posts",auth,(req,res)=>{
 const text=(req.body.text||"").trim();
 if(!text)return res.status(400).json({error:"Пост не может быть пустым"});
 if(text.length>1000)return res.status(400).json({error:"Максимум 1000 символов"});
 const info=db.prepare("INSERT INTO posts(user_id,text) VALUES(?,?)").run(req.session.userId,text);
 res.json({id:info.lastInsertRowid});
});
app.get("/api/posts",(req,res)=>{
 const rows=db.prepare(`SELECT posts.id,posts.text,posts.created_at,users.id user_id,users.nickname,users.photo,
 (SELECT COUNT(*) FROM likes WHERE likes.post_id=posts.id) likes,
 EXISTS(SELECT 1 FROM likes WHERE likes.post_id=posts.id AND likes.user_id=?) liked
 FROM posts JOIN users ON users.id=posts.user_id ORDER BY posts.id DESC LIMIT 100`).all(req.session.userId||0);
 res.json(rows);
});
app.post("/api/posts/:id/like",auth,(req,res)=>{
 const id=Number(req.params.id), exists=db.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").get(req.session.userId,id);
 if(exists) db.prepare("DELETE FROM likes WHERE user_id=? AND post_id=?").run(req.session.userId,id);
 else db.prepare("INSERT OR IGNORE INTO likes(user_id,post_id) VALUES(?,?)").run(req.session.userId,id);
 res.json({liked:!exists});
});
app.post("/api/follow/:id",auth,(req,res)=>{
 const id=Number(req.params.id); if(id===req.session.userId)return res.status(400).json({error:"Нельзя подписаться на себя"});
 const e=db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?").get(req.session.userId,id);
 if(e) db.prepare("DELETE FROM follows WHERE follower_id=? AND following_id=?").run(req.session.userId,id);
 else db.prepare("INSERT OR IGNORE INTO follows(follower_id,following_id) VALUES(?,?)").run(req.session.userId,id);
 res.json({following:!e});
});
app.get("/api/messages/:id",auth,(req,res)=>{
 const other=Number(req.params.id);
 const rows=db.prepare(`SELECT messages.id,messages.text,messages.sender_id,messages.receiver_id,messages.created_at,users.nickname
 FROM messages JOIN users ON users.id=messages.sender_id
 WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
 ORDER BY messages.id ASC LIMIT 200`).all(req.session.userId,other,other,req.session.userId);
 res.json(rows);
});
app.post("/api/messages/:id",auth,(req,res)=>{
 const text=(req.body.text||"").trim(), receiver=Number(req.params.id);
 if(!text)return res.status(400).json({error:"Сообщение пустое"});
 if(!db.prepare("SELECT id FROM users WHERE id=?").get(receiver))return res.status(404).json({error:"Пользователь не найден"});
 db.prepare("INSERT INTO messages(sender_id,receiver_id,text) VALUES(?,?,?)").run(req.session.userId,receiver,text);
 res.json({ok:true});
});

app.get("/api/users",(req,res)=>{
 const rows=db.prepare("SELECT id,nickname,about,hobbies,photo FROM users ORDER BY id DESC LIMIT 100").all();
 res.json(rows.map(x=>({...x,hobbies:x.hobbies?x.hobbies.split(",").filter(Boolean):[]})));
});
app.listen(PORT,HOST,()=>console.log(`ProfileSpace: http://${HOST}:${PORT}`));
