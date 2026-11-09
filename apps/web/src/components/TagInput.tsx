import { useState } from 'react';

// Tag editor: chips for selected tags + suggestions from previously used tags.
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Tag tippen, Enter…',
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setInput('');
  };
  const remove = (t: string) => onChange(value.filter((x) => x !== t));

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input);
    } else if (e.key === 'Backspace' && !input && value.length) {
      remove(value[value.length - 1]);
    }
  };

  const filtered = suggestions
    .filter((s) => !value.includes(s) && s.toLowerCase().includes(input.toLowerCase()))
    .slice(0, 12);

  return (
    <div className="stack gap-sm">
      <div className="tag-input">
        {value.map((t) => (
          <button type="button" key={t} className="chip chip--removable" onClick={() => remove(t)}>
            {t} ✕
          </button>
        ))}
        <input
          className="tag-input__field"
          value={input}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      {filtered.length > 0 && (
        <div className="row wrap gap-xs">
          {filtered.map((s) => (
            <button type="button" key={s} className="chip tag-suggest" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
