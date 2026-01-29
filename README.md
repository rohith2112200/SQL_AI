# SQL.ai Enterprise Interface

**Intelligent Data Query Interface** powered by Google Gemini. Transform natural language into executable SQL queries with safe, enterprise-grade validation and mock execution.

## 🚀 Features

*   **Natural Language Processing**: Converts English questions (e.g., "Show high-value customers in New York") into valid SQL.
*   **Mock Execution Engine**: robust, in-memory SQL execution supporting:
    *   **Universal Joins**: Automatically links Orders, Customers, Products, and Categories.
    *   **Complex Filtering**: Supports multiple `AND` conditions, `COUNT` aggregations, and strict column validation.
    *   **Aggregations**: `COUNT`, `LIMIT`, and `ORDER BY` support.
*   **Enterprise UI**:
    *   **Emerald Theme**: Clean, accessible, light-green design system.
    *   **Glassmorphism**: Modern UI components with smooth animations.
    *   **Safety First**: Automatic detection of destructive keywords (DELETE, DROP, etc.).
*   **Data Tools**:
    *   CSV Export functionality.
    *   Dynamic Result Limiting (10, 20, 50, All).
    *   Copy-to-Clipboard with visual feedback.

## 🛠️ Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd SQL_AI
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Environment Setup**:
    Create a `.env` file in the root directory:
    ```env
    GEMINI_API_KEY=your_google_ai_key_here
    ```

4.  **Start the Server**:
    ```bash
    npm start
    ```
    Access the application at `http://localhost:3000`.

## 🏗️ Architecture

*   **Backend**: Node.js + Express
*   **AI Model**: Google Gemini 2.0 Flash (via `@google/generative-ai`)
*   **Frontend**: Native HTML5, CSS3 (Variables + Flexbox), Vanilla JavaScript.
*   **Data**: In-memory Mock Database (`MOCK_DB` in `server.js`) simulating an E-commerce schema.

## 🧪 Sample Queries

Try these queries in the interface:
*   *"Show all orders from New York where amount is greater than 500"*
*   *"How many orders are in the Clothing category?"*
*   *"List top 10 most expensive products"*
*   *"Show customers from California sorted by name"*

## 📝 License

Proprietary Enterprise License.
