// next/image shim: plain <img> with `fill` emulation.
import { forwardRef, type CSSProperties, type ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
};

const fillStyle: CSSProperties = {
  position: "absolute",
  height: "100%",
  width: "100%",
  inset: 0,
  objectFit: "cover",
};

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  { fill, priority: _p, quality: _q, unoptimized: _u, style, ...rest },
  ref,
) {
  return <img ref={ref} style={fill ? { ...fillStyle, ...style } : style} {...rest} />;
});

export default Image;
