import { useEffect } from 'react';
import './HandAnimation.css';
import zeroImg from '../assets/images/zero.png';
import oneImg from '../assets/images/one.png';
import twoImg from '../assets/images/two.png';
import threeImg from '../assets/images/three.png';
import fourImg from '../assets/images/four.png';
import fiveImg from '../assets/images/five.png';
import sixImg from '../assets/images/six.png';

interface HandAnimationProps {
  number: number | null;
  isAnimating: boolean;
}

const handImages = {
  0: zeroImg,
  1: oneImg,
  2: twoImg,
  3: threeImg,
  4: fourImg,
  5: fiveImg,
  6: sixImg,
};

// Preload all images when the component mounts (optional, prevents flicker)
const preloadImages = () => {
  Object.values(handImages).forEach((src) => {
    const img = new Image();
    img.src = src;
  });
};

export default function HandAnimation({ number, isAnimating }: HandAnimationProps) {
  useEffect(() => {
    preloadImages();
  }, []);

  return (
    <div className="hand-animation-container">
      {isAnimating ? (
        <img src={zeroImg} alt="Fist shaking" className="hand-image shaking" />
      ) : number !== null ? (
        <img
          src={handImages[number as keyof typeof handImages]}
          alt={`Hand showing ${number}`}
          className="hand-image revealed"
        />
      ) : (
        <div className="hand-placeholder">✋</div>
      )}
    </div>
  );
}