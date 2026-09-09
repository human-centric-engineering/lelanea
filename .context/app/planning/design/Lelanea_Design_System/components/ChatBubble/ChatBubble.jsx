/** A single chat turn. `from="ai"` renders the stone bubble with the lotus avatar; `from="user"` the teal bubble. */
export function ChatBubble({ from = 'ai', children, avatar = true, style }) {
  const isAI = from === 'ai';
  const bubble = {
    padding: '12px 16px', borderRadius: 20, maxWidth: '78%',
    fontSize: 15, lineHeight: 1.45,
    fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
    background: isAI ? '#EBE6DF' : '#17718A',
    color: isAI ? '#11181A' : '#F3F0EC',
    borderBottomLeftRadius: isAI ? 6 : 20,
    borderBottomRightRadius: isAI ? 20 : 6,
  };

  const LM = typeof LotusMark === 'function' ? LotusMark : null;

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-end',
      justifyContent: isAI ? 'flex-start' : 'flex-end', ...style,
    }}>
      {isAI && avatar && LM && <LM size={34} water={false} />}
      <div style={bubble}>{children}</div>
    </div>
  );
}
