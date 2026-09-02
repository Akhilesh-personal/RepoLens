import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { CommandPalette } from "./components/CommandPalette";
import { Grain } from "./components/Grain";
import Home from "./pages/Home";
import Repo from "./pages/Repo";

export default function App() {
  return (
    <BrowserRouter>
      <Grain />
      <AuthGate>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/repo/:owner/:name" element={<Repo />} />
        </Routes>
        <CommandPalette />
      </AuthGate>
    </BrowserRouter>
  );
}
