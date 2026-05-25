interface Props {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

export default function SharkIcon({ size = 16, className, style, alt }: Props) {
  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        fontSize: Math.round(size * 0.95),
        lineHeight: 1,
        verticalAlign: 'middle',
        ...style,
      }}
    >
      🦈
    </span>
  );
}
