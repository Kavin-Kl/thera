import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ConnectorGrid from "../Connectors/ConnectorGrid";

const CORAL = '#e8603a';
const DARK_BG = '#18120a';
const MONO = 'IBM Plex Mono, monospace';
const BRIC = 'Bricolage Grotesque, sans-serif';

const SPRING = { type: 'spring', stiffness: 280, damping: 26 };

const onboardingScreens = [
  {
    id: 'welcome',
    title: 'oh, hello.',
    text: "you're new here. that's either brave or desperate — both are valid, honestly. i'm thera. think of me as that friend who actually listens, swears a bit too much, and will absolutely ask if you've eaten.",
    type: 'intro'
  },
  {
    id: 'permissions',
    title: 'need access.',
    text: "to actually help you, i need to see what you're doing. nothing creepy, i promise. just window titles and activity patterns. your data never leaves your device.\n\non mac: accessibility & screen recording permissions\non windows: just needs to run (no extra perms)",
    question: 'grant permissions?',
    type: 'permissions'
  },
  {
    id: 'vibe_check',
    title: 'quick vibe check.',
    text: "before we do anything — how's your brain today? no wrong answers. well, there are, but none of these are them.",
    question: "how's it going in there?",
    type: 'single',
    options: [
      "it's actually okay today, weirdly",
      "like a browser with 47 tabs open",
      "running on caffeine and denial",
      "somewhere between numb and overwhelmed",
      "i don't even know how to answer that",
      "chaotic but make it fashion"
    ]
  },
  {
    id: 'want_from_app',
    title: 'what are you here for?',
    text: "no judgement. genuinely. pick as many as feel right.",
    question: 'what do you want from this?',
    type: 'multi',
    options: [
      "someone to vent to at 2am",
      "help organising the chaos in my head",
      "a perspective that isn't mine for once",
      "coping strategies that don't sound like a pamphlet",
      "honestly just company",
      "i'm not sure yet and that's fine"
    ]
  },
  {
    id: 'nsfw_mode',
    title: 'content filter.',
    text: "thera can be raw and unfiltered, or keep it a bit safer. your call. you can always change this later in settings.",
    question: 'nsfw mode?',
    type: 'single',
    options: [
      "on — let thera speak freely",
      "off — keep it safer"
    ]
  },
  {
    id: 'age_group',
    title: 'age check.',
    text: "not for anything weird. just helps me calibrate between 'existential crisis about uni' and 'existential crisis about mortgages'.",
    question: 'roughly where are you?',
    type: 'single',
    options: [
      "under 18",
      "18–24",
      "25–34",
      "35–44",
      "45+",
      "age is a construct and i reject it"
    ]
  },
  {
    id: 'coping',
    title: 'coping mechanisms.',
    text: "how do you usually deal with the hard stuff? again, no judgement. i once ate an entire cake in a bathtub so.",
    question: 'pick all that apply.',
    type: 'multi',
    options: [
      "i talk to people (shocking, i know)",
      "i bottle it up until i implode",
      "humour. dark humour. very dark humour.",
      "i doom scroll until my eyes burn",
      "exercise / moving my body",
      "i just... don't. i go numb.",
      "journaling or writing it out",
      "crying in the shower, obviously"
    ]
  },
  {
    id: 'tone',
    title: 'set the tone.',
    text: "how do you want me to talk to you? i can adjust. slightly.",
    question: 'what works for you?',
    type: 'single',
    options: [
      "be honest, even if it stings a bit",
      "gentle. i'm fragile right now.",
      "make me laugh or i'll cry",
      "straight to the point, no fluff",
      "like a friend who's seen my worst"
    ]
  },
  {
    id: 'struggles',
    title: 'the hard bit.',
    text: "what's been sitting heavy lately? you don't have to pick any of these. but if something fits, it helps me help you.",
    question: 'anything here feel familiar?',
    type: 'multi',
    options: [
      "anxiety that won't shut up",
      "depression or just... flatness",
      "loneliness, even around people",
      "relationship stuff",
      "grief or loss",
      "burnout from work / life / everything",
      "self-worth issues",
      "i don't have a label for it yet"
    ]
  },
  {
    id: 'name',
    title: 'one last thing.',
    text: "what should i call you? doesn't have to be your real name. could be anything. i once knew someone who went by 'toast' and honestly it suited them.",
    question: "what's your name?",
    type: 'text'
  },
  {
    id: 'connectors',
    title: 'plug me in.',
    text: "i can do more than just talk. hook up your stuff and i can send emails, queue songs, schedule things, send whatsapps. all optional. all skippable. you can do this later in settings too.",
    question: 'connect what feels right.',
    type: 'connectors'
  },
  {
    id: 'done',
    title: "right. that's us.",
    text: "i know enough now. not everything — god, that would be terrifying — but enough to actually be useful. or at least try.\n\nwhenever you're ready, i'm here. no rush. no pressure. just... here.",
    type: 'done'
  }
];

const { ipcRenderer } = window.require ? window.require('electron') : {};

function Onboarding({ onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [permissionsChecking, setPermissionsChecking] = useState(false);

  const currentScreen = onboardingScreens[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === onboardingScreens.length - 1;

  const handleNext = () => {
    // Save answer
    if (currentScreen.type === 'single' && selectedOptions.length > 0) {
      setAnswers({ ...answers, [currentScreen.id]: selectedOptions[0] });
    } else if (currentScreen.type === 'multi') {
      setAnswers({ ...answers, [currentScreen.id]: selectedOptions });
    } else if (currentScreen.type === 'text' && textInput.trim()) {
      setAnswers({ ...answers, [currentScreen.id]: textInput.trim() });
    }

    // Move to next or complete
    if (isLast) {
      onComplete(answers);
    } else {
      setCurrentIndex(currentIndex + 1);
      setSelectedOptions([]);
      setTextInput('');
      setPermissionsGranted(false);
    }
  };

  const handleBack = () => {
    if (!isFirst) {
      setCurrentIndex(currentIndex - 1);
      setSelectedOptions([]);
      setTextInput('');
      setPermissionsGranted(false);
    }
  };

  const toggleOption = (option) => {
    if (currentScreen.type === 'single') {
      setSelectedOptions([option]);
    } else if (currentScreen.type === 'multi') {
      if (selectedOptions.includes(option)) {
        setSelectedOptions(selectedOptions.filter(o => o !== option));
      } else {
        setSelectedOptions([...selectedOptions, option]);
      }
    }
  };

  const requestPermissions = async () => {
    setPermissionsChecking(true);
    try {
      const result = await ipcRenderer?.invoke('request-permissions');
      if (result?.granted) {
        setPermissionsGranted(true);
      } else if (result?.message) {
        // Show message to user (macOS)
        alert(result.message);
      }
    } catch (err) {
      console.error('Permission request failed:', err);
    } finally {
      setPermissionsChecking(false);
    }
  };

  const canProceed =
    currentScreen.type === 'intro' ||
    currentScreen.type === 'done' ||
    currentScreen.type === 'connectors' ||
    (currentScreen.type === 'permissions' && permissionsGranted) ||
    (currentScreen.type === 'text' && textInput.trim()) ||
    ((currentScreen.type === 'single' || currentScreen.type === 'multi') && selectedOptions.length > 0);

  return (
    <div style={{
      height: '100vh',
      background: DARK_BG,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: BRIC,
      overflow: 'hidden',
      padding: '20px',
    }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          maxWidth: currentScreen.type === 'connectors' ? 760 : 600,
          width: '100%',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Progress indicator */}
        <div style={{
          display: 'flex',
          gap: 6,
          marginBottom: 30,
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {onboardingScreens.map((_, idx) => (
            <motion.div
              key={idx}
              animate={{
                width: idx === currentIndex ? 32 : 8,
                background: idx <= currentIndex ? CORAL : 'rgba(255,255,255,0.15)',
              }}
              transition={SPRING}
              style={{
                height: 3,
                borderRadius: 2,
              }}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentScreen.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Content area */}
            <div style={{
              flex: '1 1 auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              marginBottom: 20,
            }}>
              {/* Title */}
              <h1 style={{
                fontFamily: BRIC,
                fontSize: 'clamp(24px, 5vw, 38px)',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.95)',
                marginBottom: 12,
                letterSpacing: '-0.02em',
                flexShrink: 0,
              }}>
                {currentScreen.title}
              </h1>

              {/* Description text */}
              <p style={{
                fontFamily: BRIC,
                fontSize: 'clamp(13px, 2vw, 15px)',
                fontWeight: 300,
                color: 'rgba(255,255,255,0.7)',
                lineHeight: 1.5,
                marginBottom: 20,
                whiteSpace: 'pre-line',
                flexShrink: 0,
              }}>
                {currentScreen.text}
              </p>

              {/* Question label */}
              {currentScreen.question && (
                <p style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '1.5px',
                  color: CORAL,
                  marginBottom: 12,
                  flexShrink: 0,
                }}>
                  {currentScreen.question}
                </p>
              )}

              {/* Options (single/multi select) - scrollable */}
              {(currentScreen.type === 'single' || currentScreen.type === 'multi') && (
                <div style={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  paddingRight: 8,
                  marginBottom: 12,
                }}>
                  {currentScreen.options.map((option, idx) => {
                    const isSelected = selectedOptions.includes(option);
                    return (
                      <motion.button
                        key={idx}
                        onClick={() => toggleOption(option)}
                        whileHover={{ scale: 1.01, x: 2 }}
                        whileTap={{ scale: 0.98 }}
                        style={{
                          background: isSelected ? 'rgba(232,96,58,0.15)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isSelected ? CORAL : 'rgba(255,255,255,0.1)'}`,
                          borderRadius: 10,
                          padding: '12px 16px',
                          fontFamily: BRIC,
                          fontSize: 'clamp(13px, 2vw, 14px)',
                          fontWeight: 400,
                          color: isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          flexShrink: 0,
                        }}
                      >
                        {option}
                      </motion.button>
                    );
                  })}
                </div>
              )}

              {/* Text input */}
              {currentScreen.type === 'text' && (
                <div style={{ marginBottom: 12, flexShrink: 0 }}>
                  <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="type here..."
                    autoFocus
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 10,
                      padding: '12px 16px',
                      fontFamily: BRIC,
                      fontSize: 14,
                      color: 'rgba(255,255,255,0.95)',
                      outline: 'none',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = CORAL;
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = 'rgba(255,255,255,0.1)';
                    }}
                  />
                </div>
              )}

              {/* Connector grid */}
              {currentScreen.type === 'connectors' && (
                <div style={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  paddingRight: 8,
                  marginBottom: 12,
                }}>
                  <ConnectorGrid dark={true} compact />
                </div>
              )}

              {/* Permissions request */}
              {currentScreen.type === 'permissions' && (
                <div style={{ marginBottom: 12, flexShrink: 0 }}>
                  {permissionsGranted ? (
                    <div style={{
                      background: 'rgba(34, 197, 94, 0.15)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      borderRadius: 10,
                      padding: '12px 16px',
                      fontFamily: BRIC,
                      fontSize: 13,
                      color: 'rgba(34, 197, 94, 0.95)',
                      textAlign: 'center',
                    }}>
                      ✓ permissions granted. you're all set.
                    </div>
                  ) : (
                    <motion.button
                      onClick={requestPermissions}
                      disabled={permissionsChecking}
                      whileHover={{ scale: permissionsChecking ? 1 : 1.02 }}
                      whileTap={{ scale: permissionsChecking ? 1 : 0.98 }}
                      style={{
                        width: '100%',
                        background: permissionsChecking ? 'rgba(255,255,255,0.08)' : CORAL,
                        border: 'none',
                        borderRadius: 10,
                        padding: '14px 20px',
                        fontFamily: BRIC,
                        fontSize: 14,
                        fontWeight: 500,
                        color: '#fff',
                        cursor: permissionsChecking ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: permissionsChecking ? 'none' : `0 4px 16px rgba(232,96,58,0.3)`,
                      }}
                    >
                      {permissionsChecking ? 'checking permissions...' : 'grant permissions'}
                    </motion.button>
                  )}
                </div>
              )}
            </div>

            {/* Navigation - always visible at bottom */}
            <div style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'space-between',
              flexShrink: 0,
              paddingTop: 12,
              borderTop: '1px solid rgba(255,255,255,0.05)',
            }}>
              <motion.button
                onClick={handleBack}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 50,
                  padding: '10px 24px',
                  fontFamily: MONO,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '1.2px',
                  color: 'rgba(255,255,255,0.5)',
                  cursor: isFirst ? 'not-allowed' : 'pointer',
                  opacity: isFirst ? 0.3 : 1,
                  transition: 'all 0.2s',
                  flexShrink: 0,
                }}
                disabled={isFirst}
              >
                back
              </motion.button>

              <motion.button
                onClick={handleNext}
                whileHover={{ scale: canProceed ? 1.03 : 1 }}
                whileTap={{ scale: canProceed ? 0.97 : 1 }}
                style={{
                  background: canProceed ? CORAL : 'rgba(255,255,255,0.08)',
                  border: 'none',
                  borderRadius: 50,
                  padding: '10px 28px',
                  fontFamily: MONO,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '1.2px',
                  color: canProceed ? '#fff' : 'rgba(255,255,255,0.3)',
                  cursor: canProceed ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  boxShadow: canProceed ? `0 4px 16px rgba(232,96,58,0.3)` : 'none',
                  flexShrink: 0,
                }}
                disabled={!canProceed}
              >
                {isLast ? 'finish' : 'next'}
              </motion.button>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default Onboarding;
