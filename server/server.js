import dotenv from "dotenv";
import { createApp } from "./app.js";
import { connectCentralDB } from "./config/db.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectCentralDB();
    const app = createApp();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch {
    console.error("Unable to start the server");
    process.exit(1);
  }
};

startServer();
