# 🚀 Project Setup & Run Guide

## 📋 Prerequisites

Make sure you have the following installed:

- **Node.js** (v18+ recommended)  
- **npm** or **yarn** (comes with Node)  
- **Docker** (latest version)
- **Git** (to clone repository if needed)  


## 📂 Project Structure
```
project-root/
│── Frontend/             # React app
│── Parallel_Backend_Bot/ # Python backend (Dockerized)
```

---

## ▶️ Running the Frontend (React)

1. Navigate to the frontend folder:
   cd Frontend

2. Install dependencies:
   npm install
   # or
   yarn install

3. Create `.env` file (if required):

4. Start development server:
   npm run dev
   # or
   yarn run dev

5. The React app will run at:
   http://localhost:5173

---

## ▶️ Running the Backend (Python with Docker)

1. Navigate to the backend folder:
   cd Parallel_Backend_Bot`

2. Build Docker image:
   docker compose build

3. Start backend services:
   docker compose up -d

4. Backend should now be running at:
   http://localhost:8000

5. Swagger now be running at:
   http://localhost:8000/docs


## 🛠 Useful Commands

- Stop all backend services:

  docker compose down


## ✅ Final Run

1. Start backend with Docker (`docker compose up -d`).  
2. Start frontend (`npm run dev`).  
3. Open browser at `http://localhost:5173`.  
4. Frontend will call backend APIs running on `http://localhost:8000`.  
