import { describe, it } from "node:test";
import assert from "node:assert";
import { initDb, getAllTodos, createTodo, getTodo, updateTodo, deleteTodo } from "./db.js";

describe("Todo CRUD", () => {
  let db;

  it("init db", async () => {
    db = await initDb(":memory:");
    assert.ok(db);
  });

  it("starts empty", () => {
    assert.deepStrictEqual(getAllTodos(db), []);
  });

  it("creates a todo", () => {
    const todo = createTodo(db, "Test todo");
    assert.strictEqual(todo.title, "Test todo");
    assert.strictEqual(todo.done, false);
  });

  it("lists todos", () => {
    const todos = getAllTodos(db);
    assert.strictEqual(todos.length, 1);
  });

  it("updates a todo", () => {
    const updated = updateTodo(db, 1, { done: true });
    assert.strictEqual(updated.done, true);
  });

  it("deletes a todo", () => {
    deleteTodo(db, 1);
    assert.strictEqual(getAllTodos(db).length, 0);
  });
});
