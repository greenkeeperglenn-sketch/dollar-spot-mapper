declare module "perspective-transform" {
  interface PerspT {
    /** Forward homography coefficients [a,b,c,d,e,f,g,h] (i=1 implicit). */
    coeffs: number[];
    /** Inverse homography coefficients [a',b',c',d',e',f',g',h']. */
    coeffsInv: number[];
    /** Forward map: source pixel -> destination pixel. */
    transform(x: number, y: number): [number, number];
    /** Inverse map: destination pixel -> source pixel. */
    transformInverse(x: number, y: number): [number, number];
  }
  /**
   * srcCorners and dstCorners are flat 8-number arrays
   * [x1,y1, x2,y2, x3,y3, x4,y4] in TL, TR, BR, BL order.
   */
  function PerspT(srcCorners: number[], dstCorners: number[]): PerspT;
  export default PerspT;
}
