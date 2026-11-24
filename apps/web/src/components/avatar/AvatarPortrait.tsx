import { useEffect, useState } from 'react';

import { cropStyle, type AvatarImage } from '../../state/avatar.js';

/**
 * A character's portrait in a frame the caller's class shapes (a circle by
 * default). The picture fills it; a missing file leaves the empty frame rather
 * than a broken-image icon.
 */
export function AvatarPortrait({
  image,
  className = 'avatar-portrait',
  label,
}: {
  image: AvatarImage;
  className?: string;
  /** Alt text; omitted, the portrait is decorative. */
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image.src]);

  return (
    <span className={`avatar-frame ${className}`} role={label === undefined ? undefined : 'img'} aria-label={label}>
      {failed ? null : (
        <img src={image.src} alt="" style={cropStyle(image.crop)} onError={() => setFailed(true)} />
      )}
    </span>
  );
}
