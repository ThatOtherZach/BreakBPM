interface Props {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

export default function SharkIcon({ size = 16, className, style, alt = '' }: Props) {
  return (
    <img
      src="/shark-icon.png"
      alt={alt}
      className={className}
      style={{
        width: size,
        height: size,
        imageRendering: 'pixelated',
        verticalAlign: 'middle',
        display: 'inline-block',
        ...style,
      }}
    />
  );
}
