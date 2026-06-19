import express from "express";
import { initDb, getAllTodos, getTodo, createTodo, updateTodo, deleteTodo, searchTodos } from "./db.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const app = express();
app.use(express.json());

let db;

app.get("/health", (_req, res) => {
  res.json({ ok: true, port: PORT, ts: new Date().toISOString() });
});

app.get("/", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>Sample App</title>
    <style>
      body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px;background:#0f172a;color:#e2e8f0}
      h1{color:#38bdf8}
      input,button{padding:8px 12px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;margin:4px}
      button{cursor:pointer;background:#2563eb;border-color:#3b82f6}
      button:hover{background:#1d4ed8}
      .todo{padding:10px;margin:8px 0;background:#1e293b;border-radius:8px;display:flex;align-items:center;gap:10px}
      .todo.done span{text-decoration:line-through;color:#64748b}
      .delete{background:#dc2626;border-color:#ef4444;font-size:12px}
    </style></head>
    <body>
      <h1>Todo App</h1>
      <p>Port: ${PORT}</p>
      <div>
        <input id="inp" placeholder="New todo..." />
        <button onclick="addTodo()">Add</button>
      </div>
      <div id="list"></div>
      <script>
        async function load(){
          const r=await fetch('/api/todos');const todos=await r.json();
          document.getElementById('list').innerHTML=todos.map(t=>
            '<div class="todo '+(t.done?'done':'')+'">'+
            '<input type="checkbox" '+(t.done?'checked':'')+' onchange="toggle('+t.id+',this.checked)"/>'+
            '<span>'+t.title+'</span>'+
            '<button class="delete" onclick="del('+t.id+')">x</button>'+
            '</div>'
          ).join('');
        }
        async function addTodo(){
          const inp=document.getElementById('inp');
          if(!inp.value.trim())return;
          await fetch('/api/todos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:inp.value})});
          inp.value='';load();
        }
        async function toggle(id,done){
          await fetch('/api/todos/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({done})});
          load();
        }
        async function del(id){
          await fetch('/api/todos/'+id,{method:'DELETE'});
          load();
        }
        load();
      </script>
    </body></html>
  `);
});

app.get("/api/todos", (_req, res) => {
  res.json(getAllTodos(db));
});

app.get("/api/todos/search", (req, res) => {
  const q = req.query.q || "";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
  res.json(searchTodos(db, { q, page, limit }));
});

app.get("/api/todos/:id", (req, res) => {
  const todo = getTodo(db, parseInt(req.params.id, 10));
  if (!todo) return res.status(404).json({ error: "Not found" });
  res.json(todo);
});

app.post("/api/todos", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const todo = createTodo(db, title);
  res.status(201).json(todo);
});

app.put("/api/todos/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = getTodo(db, id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const updated = updateTodo(db, id, req.body);
  res.json(updated);
});

app.delete("/api/todos/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  deleteTodo(db, id);
  res.json({ ok: true });
});

async function main() {
  db = await initDb(process.env.DATABASE_URL);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Sample app running on http://localhost:${PORT}`);
  });
}

main().catch(err => { console.error(err); process.exit(1); });
