import { describe, it } from "node:test";
import assert from "node:assert";
import { initDb, getAllTodos, createTodo, getTodo, updateTodo, deleteTodo, searchTodos } from "./db.js";

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

describe("searchTodos", () => {
  let db;

  it("init db", async () => {
    db = await initDb(":memory:");
    assert.ok(db);
  });

  it("returns empty results when no todos exist", () => {
    const result = searchTodos(db, { q: "anything", page: 1, limit: 10 });
    assert.deepStrictEqual(result, { data: [], total: 0, page: 1, limit: 10 });
  });

  it("matches on title (case-insensitive)", () => {
    createTodo(db, "Buy groceries");
    createTodo(db, "buy milk");
    createTodo(db, "Walk the dog");

    const result = searchTodos(db, { q: "buy", page: 1, limit: 10 });
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.data.length, 2);
    assert.ok(result.data.every(t => t.title.toLowerCase().includes("buy")));
  });

  it("returns correct pagination metadata", () => {
    const result = searchTodos(db, { q: "buy", page: 1, limit: 10 });
    assert.strictEqual(result.page, 1);
    assert.strictEqual(result.limit, 10);
  });

  it("paginates results", () => {
    createTodo(db, "buy apples");
    createTodo(db, "buy bananas");
    createTodo(db, "buy oranges");

    const page1 = searchTodos(db, { q: "buy", page: 1, limit: 2 });
    assert.strictEqual(page1.data.length, 2);
    assert.strictEqual(page1.total, 5);
    assert.strictEqual(page1.page, 1);
    assert.strictEqual(page1.limit, 2);

    const page2 = searchTodos(db, { q: "buy", page: 2, limit: 2 });
    assert.strictEqual(page2.data.length, 2);
    assert.strictEqual(page2.page, 2);

    const page3 = searchTodos(db, { q: "buy", page: 3, limit: 2 });
    assert.strictEqual(page3.data.length, 1);
  });

  it("returns no match for unrelated term", () => {
    const result = searchTodos(db, { q: "nonexistent", page: 1, limit: 10 });
    assert.strictEqual(result.total, 0);
    assert.deepStrictEqual(result.data, []);
  });
});
