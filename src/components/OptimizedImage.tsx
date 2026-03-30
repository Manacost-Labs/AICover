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
  ...rest
}: OptimizedImageProps) {
  return (
    <img
      decoding={decoding}
      loading={loading ?? (priority ? 'eager' : 'lazy')}
      fetchPriority={fetchPriority ?? (priority ? 'high' : 'low')}
      {...rest}
    />
  );
});
