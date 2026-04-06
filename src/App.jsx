import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Intro from "./components/Intro/Intro";
import Home from "./Home/Home";

function App() {

  const [showHome, setShowHome] = useState(false);
  const [dark, setDark] = useState(true);

  return (
    <div style={{ background: dark ? "#18120a" : "#f5ede0", minHeight: "100vh" }}>

      <AnimatePresence mode="wait">

        {!showHome && (
          <motion.div
            key="intro"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
          >
            <Intro onFinish={() => setShowHome(true)} />
          </motion.div>
        )}

        {showHome && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
          >
            <Home dark={dark} setDark={setDark} />
          </motion.div>
        )}

      </AnimatePresence>

    </div>
  );
}

export default App;
