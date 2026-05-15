import React from 'react';

interface WindowProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
  icon?: string;
  style?: React.CSSProperties;
}

export function Win98Window({ title, children, className = '', onClose, icon, style }: WindowProps) {
  return (
    <div className={`win98-window ${className}`} style={style}>
      <div className="win98-titlebar">
        <div className="win98-titlebar-left">
          {icon && <span className="win98-title-icon">{icon}</span>}
          <span className="win98-title-text">{title}</span>
        </div>
        <div className="win98-titlebar-buttons">
          <button className="win98-tb-btn">_</button>
          <button className="win98-tb-btn">□</button>
          {onClose && <button className="win98-tb-btn win98-tb-close" onClick={onClose}>✕</button>}
        </div>
      </div>
      <div className="win98-window-content">
        {children}
      </div>
    </div>
  );
}

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'primary' | 'danger';
  style?: React.CSSProperties;
  title?: string;
}

export function Win98Button({ children, onClick, disabled, className = '', variant = 'default', style, title }: ButtonProps) {
  return (
    <button
      className={`win98-btn win98-btn-${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      title={title}
    >
      {children}
    </button>
  );
}

interface InsetProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Win98Inset({ children, className = '', style }: InsetProps) {
  return (
    <div className={`win98-inset ${className}`} style={style}>
      {children}
    </div>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
  horizontal?: boolean;
}

export function Win98Field({ label, children, horizontal }: FieldProps) {
  return (
    <div className={`win98-field ${horizontal ? 'win98-field-h' : ''}`}>
      <label className="win98-label">{label}</label>
      {children}
    </div>
  );
}

interface InputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  style?: React.CSSProperties;
}

export function Win98Input({ value, onChange, placeholder, maxLength, style }: InputProps) {
  return (
    <input
      className="win98-input"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      style={style}
    />
  );
}

interface RadioGroupProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  name: string;
}

export function Win98RadioGroup({ options, value, onChange, name }: RadioGroupProps) {
  return (
    <div className="win98-radio-group">
      {options.map(opt => (
        <label key={opt.value} className="win98-radio-label">
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="win98-radio"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  style?: React.CSSProperties;
}

export function Win98Select({ value, onChange, options, style }: SelectProps) {
  return (
    <select
      className="win98-select"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={style}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

interface StatusBarProps {
  items: string[];
}

export function Win98StatusBar({ items }: StatusBarProps) {
  return (
    <div className="win98-statusbar">
      {items.map((item, i) => (
        <div key={i} className="win98-statusbar-item">{item}</div>
      ))}
    </div>
  );
}
