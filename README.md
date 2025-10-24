# 🤖 ChatBot — AI-Powered Intent-Based Assistant

ChatBot is a responsive AI assistant built using **React + Vite** on the frontend and a modular **Node.js backend**. It intelligently routes user queries based on intent—leveraging **Gemini Flash 2.0**, **OpenWeatherMap**, and **NewsAPI** to deliver accurate, real-time responses.

---

## 🚀 Features

- **Intent-Based Query Handling**  
  Automatically detects user intent across:
  - `general` → Gemini Flash 2.0
  - `weather`, `rain`, `alert` → WeatherMap API
  - `news` → NewsAPI

- **Smart Prompt Engineering**  
  Each API is guided by tailored prompts to ensure clarity, relevance, and structured output. Gemini is used for summarization, reasoning, and fallback logic.

- **Frontend**  
  - Built with **React + Vite**
  - Responsive UI with **Dark/Light Mode toggle**
  - Clean routing and modular component design

- **Backend**  
  - Runs via `npm run server`
  - Handles API orchestration and intent parsing
  - Secured with `.env` for API key management

---

## 🧠 Powered by Gemini Flash 2.0

Gemini Flash 2.0 is used to:
- Handle general queries with natural language understanding
- Summarize external API responses
- Format answers using markdown, bullet points, or JSON when needed

Prompt engineering is reflected in how each query is structured and routed, ensuring high-quality, context-aware responses.

---

## 📦 Tech Stack

| Layer       | Tools Used                     |
|-------------|--------------------------------|
| Frontend    | React, Vite, Tailwind CSS      |
| Backend     | Node.js, Express               |
| APIs        | Gemini Flash 2.0, WeatherAPI, NewsAPI |
| Dev Tools   | Postman, ESLint, dotenv        |

---

## 📁 Project Structure

```
NodeMesh_CHATBOT/
├── backend/          # Node.js backend server
│   ├── server.js     # Main server file
│   ├── package.json  # Backend dependencies
│   └── .env.example  # Example environment variables
├── frontend/         # React + Vite frontend
│   ├── src/          # React source files
│   ├── public/       # Static assets
│   ├── package.json  # Frontend dependencies
│   └── vite.config.js
└── README.md
```

---

## Testing the APIs
Use Postman to test backend endpoints by importing the API sample code/ pasting it in raw format area and request using "POST" with your API Key to verify the working.

## 🛠️ Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ANKVIT26/NodeMesh_CHATBOT.git
   cd NodeMesh_CHATBOT
   ```

2. **Backend Setup:**
   ```bash
   cd backend
   npm install
   ```
   
   Create a `.env` file in the `backend` folder:
   ```
   GEMINI_API_KEY=your_gemini_key
   WEATHER_API_KEY=your_weather_key
   NEWS_API_KEY=your_newsapi_key
   ```
   
   Start the backend server:
   ```bash
   npm run server
   ```

3. **Frontend Setup:**
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```

<img width="1919" height="877" alt="image" src="https://github.com/user-attachments/assets/c73c171f-e4ce-4302-99ca-00b094d5e0da" />


#DEMO VIDEO
https://drive.google.com/file/d/1Z-AfodYTV25SY84mCoV4Bwn10EC85z0G/view?usp=sharing




# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
