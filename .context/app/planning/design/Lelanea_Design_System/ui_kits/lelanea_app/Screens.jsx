/* Screens — Lelanea coaching app. Each receives {onNav} for navigation. */

const Screen = ({ children, style = {} }) => (
  <div style={{
    height: '100%', background: '#F3F0EC', color: '#11181A',
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    position: 'relative', overflow: 'hidden', ...style,
  }}>{children}</div>
);

/* ---------- HomeScreen — opens with the lotus ---------- */
const HomeScreen = ({ onNav, opened, setOpened }) => {
  const [greeted, setGreeted] = React.useState(opened);
  React.useEffect(() => {
    if (!opened) {
      const t = setTimeout(() => { setOpened(true); setGreeted(true); }, 2600);
      return () => clearTimeout(t);
    }
  }, []);

  return (
    <Screen>
      <div style={{ padding: '80px 24px 0', textAlign: 'center' }}>
        <Eyebrow style={{ opacity: greeted ? 1 : 0, transition: 'opacity 800ms' }}>
          a place to return to
        </Eyebrow>
      </div>

      <div style={{ display: 'grid', placeItems: 'center', marginTop: 24 }}>
        <Lotus size={142} open={opened ? true : undefined} autoOpen={!opened} />
      </div>

      <div style={{
        padding: '20px 32px', textAlign: 'center',
        opacity: greeted ? 1 : 0,
        transform: greeted ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 1200ms cubic-bezier(0.22,0.61,0.36,1), transform 1200ms cubic-bezier(0.22,0.61,0.36,1)',
        transitionDelay: '600ms',
      }}>
        <div style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 40, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#11181A',
        }}>Welcome.</div>
        <div style={{
          marginTop: 10, color: '#282C2E', fontSize: 16, lineHeight: 1.55,
          maxWidth: 320, margin: '10px auto 0',
        }}>Take a slow breath. When you're ready, we can begin.</div>
      </div>

      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 130,
        display: 'flex', justifyContent: 'center',
        opacity: greeted ? 1 : 0, transition: 'opacity 1000ms', transitionDelay: '1200ms',
      }}>
        <button onClick={() => onNav('sit')} style={{
          background: '#C96F43', color: '#F3F0EC', border: 'none',
          padding: '15px 36px', borderRadius: 999, fontSize: 16, fontWeight: 500,
          cursor: 'pointer', boxShadow: '0 8px 24px rgba(201,111,67,0.28)',
          fontFamily: "'Hanken Grotesk', system-ui",
          whiteSpace: 'nowrap',
        }}>Begin a sit</button>
      </div>
    </Screen>
  );
};

/* ---------- SitScreen — chat with the AI ---------- */
const SitScreen = ({ onNav }) => {
  const [msgs, setMsgs] = React.useState([
    { who: 'ai', text: "What would you like to bring in today?" },
  ]);
  const [val, setVal] = React.useState('');
  const endRef = React.useRef(null);

  React.useEffect(() => { endRef.current?.scrollTo?.(0, 99999); }, [msgs]);

  const send = () => {
    if (!val.trim()) return;
    const user = val.trim();
    setMsgs(m => [...m, { who: 'me', text: user }]);
    setVal('');
    setTimeout(() => {
      setMsgs(m => [...m, { who: 'ai', text: "Let's sit with that. What's underneath — before you name it?" }]);
    }, 900);
  };

  return (
    <Screen>
      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
        padding: '58px 20px 14px',
        background: 'linear-gradient(to bottom, rgba(243,240,236,0.96), rgba(243,240,236,0.7) 70%, transparent)',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LotusMark size={36} water={false} />
          <div>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, lineHeight: 1 }}>A sit</div>
            <div style={{ fontSize: 11, color: '#6F7376', letterSpacing: '0.1em', textTransform: 'lowercase', marginTop: 2 }}>
              with lelanea's teachings
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => onNav('home')} style={{
            width: 34, height: 34, borderRadius: 999, border: '1px solid rgba(111,115,118,0.24)',
            background: '#EBE6DF', display: 'grid', placeItems: 'center', cursor: 'pointer',
          }}><Icon name="close" size={16} color="#11181A"/></button>
        </div>
      </div>

      {/* Messages */}
      <div ref={endRef} style={{
        position: 'absolute', inset: '110px 0 120px', overflowY: 'auto',
        padding: '10px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {msgs.map((m, i) => m.who === 'ai' ? (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <LotusMark size={30} water={false} />
            <div style={{
              background: '#EBE6DF', color: '#11181A', padding: '12px 16px',
              borderRadius: 20, borderBottomLeftRadius: 6, maxWidth: '78%',
              fontSize: 15, lineHeight: 1.45,
            }}>{m.text}</div>
          </div>
        ) : (
          <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{
              background: '#17718A', color: '#F3F0EC', padding: '12px 16px',
              borderRadius: 20, borderBottomRightRadius: 6, maxWidth: '78%',
              fontSize: 15, lineHeight: 1.45,
            }}>{m.text}</div>
          </div>
        ))}
      </div>

      {/* Input capsule */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 28,
        padding: '28px 16px 10px',
        background: 'linear-gradient(to top, rgba(243,240,236,0.98) 30%, rgba(243,240,236,0))',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#EBE6DF', padding: '8px 8px 8px 16px', borderRadius: 999,
          boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)',
        }}>
          <input value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="What's arriving?" style={{
            flex: 1, border: 'none', background: 'transparent', outline: 'none',
            fontFamily: "'Hanken Grotesk', system-ui", fontSize: 15, color: '#11181A',
            padding: '6px 0',
          }} />
          <button onClick={send} style={{
            width: 38, height: 38, borderRadius: 999, border: 'none',
            background: val.trim() ? '#C96F43' : '#C4B3BE',
            color: '#F3F0EC', cursor: val.trim() ? 'pointer' : 'default',
            display: 'grid', placeItems: 'center',
            transition: 'background 200ms',
          }}><Icon name="up" size={18} color="#F3F0EC"/></button>
        </div>
      </div>
    </Screen>
  );
};

/* ---------- JournalScreen ---------- */
const JournalScreen = ({ onNav }) => {
  const entries = [
    { eyb: 'yesterday', t: 'You returned to the body three times.', b: 'Notice that. Return is a practice — it doesn\'t have to be dramatic.', meta: '4 min' },
    { eyb: 'tuesday', t: 'Something soft arrived.', b: 'The tightness in your chest opened when you named it grief.', meta: '8 min' },
    { eyb: 'last week', t: 'What\'s underneath the hurry?', b: 'You stayed with the question. You didn\'t need the answer.', meta: '3 min' },
  ];
  return (
    <Screen>
      <div style={{ padding: '62px 24px 20px' }}>
        <Eyebrow>your journal</Eyebrow>
        <div style={{
          fontFamily: "'Instrument Serif', serif", fontSize: 36, lineHeight: 1.1,
          letterSpacing: '-0.02em', marginTop: 6, color: '#11181A',
        }}>What the work<br/>has held.</div>
      </div>
      <div style={{ padding: '8px 20px 140px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', height: 'calc(100% - 170px)' }}>
        {entries.map((e, i) => (
          <div key={i} style={{
            background: '#EBE6DF', borderRadius: 20, padding: 20,
            boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)',
          }}>
            <Eyebrow>{e.eyb}</Eyebrow>
            <div style={{
              fontFamily: "'Instrument Serif', serif", fontSize: 22, lineHeight: 1.2,
              marginTop: 8, color: '#11181A',
            }}>{e.t}</div>
            <div style={{ marginTop: 8, fontSize: 14, color: '#282C2E', lineHeight: 1.5 }}>{e.b}</div>
            <div style={{ marginTop: 12, fontSize: 12, color: '#6F7376' }}>{e.meta} · saved</div>
          </div>
        ))}
      </div>
    </Screen>
  );
};

/* ---------- PracticesScreen ---------- */
const PracticesScreen = ({ onNav }) => {
  const themes = ['Return', 'Breath', 'Witness', 'Body', 'Grief', 'Silence', 'Boundary'];
  const [active, setActive] = React.useState('Return');
  const practices = [
    { ttl: 'The practice of return', len: '6 min', body: 'Return to what was here before the thought.' },
    { ttl: 'Noticing without naming', len: '4 min', body: 'Let the sensation stay a sensation for one more breath.' },
    { ttl: 'A soft witness', len: '8 min', body: 'Watch the self that watches. That one is also welcome.' },
  ];
  return (
    <Screen>
      <div style={{ padding: '62px 24px 12px' }}>
        <Eyebrow>practices</Eyebrow>
        <div style={{
          fontFamily: "'Instrument Serif', serif", fontSize: 36, lineHeight: 1.1,
          letterSpacing: '-0.02em', marginTop: 6,
        }}>Short sits,<br/>drawn from the work.</div>
      </div>
      <div style={{ padding: '10px 20px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        {themes.map(t => (
          <Pill key={t} active={active === t} onClick={() => setActive(t)}>{t}</Pill>
        ))}
      </div>
      <div style={{ padding: '10px 20px 140px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {practices.map((p, i) => (
          <div key={i} style={{
            background: '#EBE6DF', borderRadius: 20, padding: 18,
            display: 'flex', alignItems: 'center', gap: 14,
            boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)',
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 999, background: '#F3F0EC',
              display: 'grid', placeItems: 'center', flex: '0 0 auto',
              boxShadow: '0 0 24px rgba(201,111,67,0.18)',
            }}><LotusMark size={42} water={false}/></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, lineHeight: 1.15 }}>{p.ttl}</div>
              <div style={{ fontSize: 13, color: '#282C2E', marginTop: 3, lineHeight: 1.4 }}>{p.body}</div>
              <div style={{ fontSize: 11, color: '#6F7376', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="clock" size={12} color="#6F7376"/> {p.len}
              </div>
            </div>
            <Icon name="chevron" size={16} color="#6F7376"/>
          </div>
        ))}
      </div>
    </Screen>
  );
};

/* ---------- YouScreen ---------- */
const YouScreen = ({ onNav }) => {
  return (
    <Screen>
      <div style={{ padding: '62px 24px 12px' }}>
        <Eyebrow>you</Eyebrow>
        <div style={{
          fontFamily: "'Instrument Serif', serif", fontSize: 36, lineHeight: 1.1,
          letterSpacing: '-0.02em', marginTop: 6,
        }}>Amara</div>
      </div>

      {/* Streak / stats */}
      <div style={{ padding: '12px 20px' }}>
        <div style={{
          background: '#EBE6DF', borderRadius: 20, padding: 18,
          display: 'flex', justifyContent: 'space-around',
          boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)',
        }}>
          {[
            { n: '12', l: 'sits this month' },
            { n: '47', l: 'reflections' },
            { n: '6', l: 'days in a row' },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 32, lineHeight: 1, color: '#17718A' }}>{s.n}</div>
              <div style={{ fontSize: 11, color: '#6F7376', letterSpacing: '0.1em', textTransform: 'lowercase', marginTop: 6 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '10px 20px 140px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Eyebrow style={{ padding: '8px 4px' }}>practice</Eyebrow>
        {[
          { i: 'clock', l: 'Sit length', v: '10 min' },
          { i: 'sparkle', l: 'Daily invitation', v: 'mornings' },
          { i: 'journal', l: 'Journal', v: 'on' },
        ].map((r, i) => (
          <div key={i} style={{
            background: '#EBE6DF', borderRadius: 16, padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Icon name={r.i} size={20} color="#6F7376"/>
            <div style={{ flex: 1, fontSize: 15 }}>{r.l}</div>
            <div style={{ color: '#6F7376', fontSize: 13 }}>{r.v}</div>
            <Icon name="chevron" size={14} color="#6F7376"/>
          </div>
        ))}
        <Eyebrow style={{ padding: '16px 4px 8px' }}>account</Eyebrow>
        {['Sessions with a human coach', 'Notifications', 'Privacy', 'Sign out'].map((l, i) => (
          <div key={i} style={{
            background: '#EBE6DF', borderRadius: 16, padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ flex: 1, fontSize: 15 }}>{l}</div>
            <Icon name="chevron" size={14} color="#6F7376"/>
          </div>
        ))}
      </div>
    </Screen>
  );
};

/* ---------- OnboardingScreen ---------- */
const OnboardingScreen = ({ onNav }) => {
  return (
    <Screen>
      <div style={{ padding: '90px 28px 0', textAlign: 'center' }}>
        <LotusMark size={110}/>
        <div style={{
          fontFamily: "'Instrument Serif', serif", fontSize: 44, lineHeight: 1.05,
          letterSpacing: '-0.02em', marginTop: 24,
        }}>You've arrived.</div>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic',
          fontSize: 20, color: '#282C2E', marginTop: 18, lineHeight: 1.35, maxWidth: 320, margin: '18px auto 0',
        }}>A quiet companion to Lelanea's Unity Consciousness work — for the space between sessions.</div>
      </div>
      <div style={{ position: 'absolute', bottom: 48, left: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button onClick={() => onNav('home')} style={{
          background: '#C96F43', color: '#F3F0EC', border: 'none',
          padding: '16px', borderRadius: 999, fontSize: 16, fontWeight: 500, cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(201,111,67,0.28)',
          fontFamily: "'Hanken Grotesk', system-ui",
        }}>Begin</button>
        <button onClick={() => onNav('home')} style={{
          background: 'transparent', color: '#11181A', border: 'none',
          padding: '12px', fontSize: 14, cursor: 'pointer',
          fontFamily: "'Hanken Grotesk', system-ui",
        }}>I have an account</button>
      </div>
    </Screen>
  );
};

Object.assign(window, { HomeScreen, SitScreen, JournalScreen, PracticesScreen, YouScreen, OnboardingScreen });
