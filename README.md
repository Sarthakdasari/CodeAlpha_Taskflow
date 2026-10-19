# TaskFlow - Collaborative Project Management Tool
**Internship Project (Task 3: Project Management Tool - Trello / Asana Alternative)**

A modern, responsive full-stack collaborative project management platform with real-time updates and team communication.

---

## ✨ Features Implemented

### 1. Group Project Management
- Create, manage, and switch between multiple group projects.
- Invite team members to collaborate on projects.
- Owner controls and member role tags.

### 2. Interactive Kanban Boards
- Four dynamic columns: **To Do**, **In Progress**, **Review**, and **Done**.
- Native **drag-and-drop** task card movement across status columns.
- Real-time column counters and task progress indicators.
- Quick filters: **All Tasks**, **My Tasks**, and **Urgent Tasks**.

### 3. Task Cards & Assignment
- Task card creation with title, description, priority levels (Urgent, High, Medium, Low), tags (Feature, Bug, Design, Backend, Security, Docs), and due dates.
- Assign tasks directly to registered team members.
- Task detail inspection modal with real-time editing and status updates.

### 4. Task Discussions & Comments
- Real-time comment threads within each task.
- Instant feedback and communication for team members.
- Timestamped comments with member avatars and roles.

### 5. Bonus: Real-Time WebSockets (Socket.io)
- **Live Board Updates**: Moving a task card on one client updates instantly for everyone on that project.
- **Instant Comments**: New comments appear without refreshing.
- **Real-Time Notification Bell**: Unread counter and notification alerts when you are assigned to a task or tagged in comments.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite (Relational, zero-config local storage with foreign keys)
- **Authentication:** JWT (JSON Web Tokens) + `bcryptjs` password hashing
- **Real-Time Engine:** WebSockets via `Socket.io`
- **Frontend:** Responsive HTML5, CSS3 (Modern SaaS design), Vanilla JavaScript

---

## 🚀 How to Run the Project

1. Open your terminal in the project directory:
   ```bash
   cd "C:\Users\SARTHAK DASARI\.gemini\antigravity\scratch\task3-project-management"
   ```

2. Start the server:
   ```bash
   node server.js
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:4000
   ```

---

## 👥 Demo Accounts Available (Pre-seeded)

You can click any demo chip on the login screen or sign in with:

| Name | Email | Password | Role |
| :--- | :--- | :--- | :--- |
| **User 1** | `user1@example.com` | `password123` | Project Lead |
| **User 2** | `user2@example.com` | `password123` | Frontend Developer |
| **User 3** | `user3@example.com` | `password123` | Backend Engineer |
| **User 4** | `user4@example.com` | `password123` | UI/UX Designer |

*Tip: You can also open two browser tabs (or an incognito window) with different users to watch tasks move and comments appear in real time!*
