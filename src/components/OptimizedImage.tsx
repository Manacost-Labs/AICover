import React from 'react';

export type OptimizedImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  /** First-visible / hero — avoid lazy for LCP */
  priority?: boolean;
};

/**
 * Thumbnails in grids: lazy + async decode + low fetch priority.
 * Priority images: eager + high fetch priority where needed.
 */
export const OptimizedImage = React.memo(function OptimizedImage({
  priority,
  decoding = 'async',
  loading,
  fetchPriority,
  onError,
  alt,
  ...rest
}: OptimizedImageProps) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
  }, [rest.src]);

  const fallback = React.useMemo(() => {
    const label = alt || 'Изображение недоступно';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#18181b"/><rect x="24" y="24" width="592" height="312" rx="28" fill="#09090b" stroke="#3f3f46" stroke-width="2"/><path d="M278 143h84v74h-84z" fill="none" stroke="#71717a" stroke-width="10" stroke-linejoin="round"/><path d="m287 205 22-28 18 22 13-15 20 21" fill="none" stroke="#71717a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><circle cx="345" cy="163" r="9" fill="#71717a"/><text x="320" y="257" fill="#a1a1aa" font-family="Arial, sans-serif" font-size="22" font-weight="700" text-anchor="middle">${label.replace(/[<>&"]/g, '')}</text><text x="320" y="286" fill="#71717a" font-family="Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle">файл изображения не найден</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [alt]);

  return (
    <img
      decoding={decoding}
      loading={loading ?? (priority ? 'eager' : 'lazy')}
      fetchPriority={fetchPriority ?? (priority ? 'high' : 'low')}
      alt={alt}
      onError={(event) => {
        if (!failed) setFailed(true);
        onError?.(event);
      }}
      {...rest}
      src={failed ? fallback : rest.src}
    />
  );
});
