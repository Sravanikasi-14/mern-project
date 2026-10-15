import { useEffect, useState } from "react";
import api from "./services/api";
import "./index.css";

function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchTasks = async () => {
    try {
      setError("");
      const response = await api.get("/tasks");
      setTasks(response.data);
    } catch {
      setError("Unable to load tasks. Check your backend.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const addTask = async (e) => {
    e.preventDefault();

    if (!title.trim()) return;

    try {
      const response = await api.post("/tasks", { title });
      setTasks((previous) => [response.data, ...previous]);
      setTitle("");
      setError("");
    } catch {
      setError("Could not create task.");
    }
  };

  const toggleTask = async (task) => {
    try {
      const response = await api.patch(`/tasks/${task._id}`, {
        completed: !task.completed,
      });

      setTasks((previous) =>
        previous.map((item) =>
          item._id === task._id ? response.data : item
        )
      );
    } catch {
      setError("Could not update task.");
    }
  };

  const deleteTask = async (id) => {
    try {
      await api.delete(`/tasks/${id}`);
      setTasks((previous) =>
        previous.filter((task) => task._id !== id)
      );
      setError("");
    } catch {
      setError("Could not delete task.");
    }
  };

  return (
    <main className="container">
      <h1>Task Manager</h1>
      <p className="subtitle">Your tasks, all in one place.</p>

      <form onSubmit={addTask} className="task-form">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter a task..."
          aria-label="Task title"
          required
        />
        <button type="submit">Add task</button>
      </form>

      {error && <p role="alert" className="error">{error}</p>}

      {loading ? (
        <p>Loading tasks...</p>
      ) : tasks.length === 0 ? (
        <p>No tasks yet. Add your first one!</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task._id} className="task-item">
              <label>
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => toggleTask(task)}
                />
                <span className={task.completed ? "completed" : ""}>
                  {task.title}
                </span>
              </label>

              <button
                type="button"
                className="delete-button"
                onClick={() => deleteTask(task._id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="count">{tasks.length} total tasks</p>
    </main>
  );
}

export default App;