// Test-only page: mounts the board without Clerk. ?user=user_shannon picks the fake identity.
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import BoardRoutes, { parseBoardHash } from "../../src/board/BoardRoutes";

const user = new URLSearchParams(location.search).get("user") || "user_josh";
const getToken = async () => "tok:" + user;
function App() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const route = parseBoardHash(h);
  if (!route) return <div id="home">home <a href="#board">board</a></div>;
  return <BoardRoutes route={route} getToken={getToken} apiBase={`http://localhost:${location.port === "5199" ? 4010 : 4010}/api/board`} />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
