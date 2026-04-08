import { useState, useEffect, useRef } from 'react';
import { Palmtree as IslandIcon } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';

function Pupil({ size = 12, maxDistance = 5, pupilColor = 'black', forceLookX, forceLookY }) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const pupilRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const calculatePupilPosition = () => {
    if (!pupilRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }
    const pupil = pupilRef.current.getBoundingClientRect();
    const pupilCenterX = pupil.left + pupil.width / 2;
    const pupilCenterY = pupil.top + pupil.height / 2;
    const deltaX = mouseX - pupilCenterX;
    const deltaY = mouseY - pupilCenterY;
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);
    const angle = Math.atan2(deltaY, deltaX);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  };

  const pupilPosition = calculatePupilPosition();

  return (
    <div
      ref={pupilRef}
      className="rounded-full"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
        transition: 'transform 0.1s ease-out',
      }}
    />
  );
}

function EyeBall({
  size = 48,
  pupilSize = 16,
  maxDistance = 10,
  eyeColor = 'white',
  pupilColor = 'black',
  isBlinking = false,
  forceLookX,
  forceLookY,
}) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const eyeRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const calculatePupilPosition = () => {
    if (!eyeRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }
    const eye = eyeRef.current.getBoundingClientRect();
    const eyeCenterX = eye.left + eye.width / 2;
    const eyeCenterY = eye.top + eye.height / 2;
    const deltaX = mouseX - eyeCenterX;
    const deltaY = mouseY - eyeCenterY;
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);
    const angle = Math.atan2(deltaY, deltaX);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  };

  const pupilPosition = calculatePupilPosition();

  return (
    <div
      ref={eyeRef}
      className="flex items-center justify-center rounded-full transition-all duration-150"
      style={{
        width: `${size}px`,
        height: isBlinking ? '2px' : `${size}px`,
        backgroundColor: eyeColor,
        overflow: 'hidden',
      }}
    >
      {!isBlinking && (
        <div
          className="rounded-full"
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
            transition: 'transform 0.1s ease-out',
          }}
        />
      )}
    </div>
  );
}

export function AnimatedCharacters({
  isTyping = false,
  showPassword = false,
  brandLabel,
  footerLinks,
}) {
  const { t } = useI18n();
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  const purpleRef = useRef(null);
  const blackRef = useRef(null);
  const yellowRef = useRef(null);
  const orangeRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;
    const scheduleBlink = () =>
      setTimeout(() => {
        setIsPurpleBlinking(true);
        setTimeout(() => {
          setIsPurpleBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());
    const timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;
    const scheduleBlink = () =>
      setTimeout(() => {
        setIsBlackBlinking(true);
        setTimeout(() => {
          setIsBlackBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());
    const timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const timer = setTimeout(() => setIsLookingAtEachOther(false), 800);
      return () => clearTimeout(timer);
    }
    setIsLookingAtEachOther(false);
    return undefined;
  }, [isTyping]);

  useEffect(() => {
    if (showPassword) {
      const peekTimeout = setTimeout(() => {
        setIsPurplePeeking(true);
        setTimeout(() => setIsPurplePeeking(false), 800);
      }, Math.random() * 3000 + 2000);
      return () => clearTimeout(peekTimeout);
    }
    setIsPurplePeeking(false);
    return undefined;
  }, [showPassword]);

  const calculatePosition = (ref) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 3;
    const deltaX = mouseX - centerX;
    const deltaY = mouseY - centerY;
    const faceX = Math.max(-15, Math.min(15, deltaX / 20));
    const faceY = Math.max(-10, Math.min(10, deltaY / 30));
    const bodySkew = Math.max(-6, Math.min(6, -deltaX / 120));
    return { faceX, faceY, bodySkew };
  };

  const purplePos = calculatePosition(purpleRef);
  const blackPos = calculatePosition(blackRef);
  const yellowPos = calculatePosition(yellowRef);
  const orangePos = calculatePosition(orangeRef);

  const label = brandLabel ?? t('login.brand');
  const links = footerLinks ?? [
    { text: t('login.privacyPolicy'), onClick: () => {} },
    { text: t('login.terms'), onClick: () => {} },
    { text: t('login.contact'), onClick: () => {} },
  ];

  return (
    <div className="relative hidden flex-col justify-between bg-gradient-to-br from-primary/90 via-primary to-primary/80 p-12 text-primary-foreground lg:flex">
      <div className="relative z-20">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-pink-500/80">
            <IslandIcon className="size-6 text-white" />
          </div>
          <span>{label}</span>
        </div>
      </div>

      <div className="relative z-20 flex h-[500px] items-end justify-center">
        <div className="relative" style={{ width: '550px', height: '400px' }}>
          <div
            ref={purpleRef}
            className="absolute bottom-0 transition-all duration-700 ease-in-out"
            style={{
              left: '70px',
              width: '180px',
              height: isTyping || (showPassword) ? '440px' : '400px',
              backgroundColor: '#6C3FF5',
              borderRadius: '10px 10px 0 0',
              zIndex: 1,
              transform:
                showPassword
                  ? `skewX(0deg)`
                  : isTyping
                    ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)`
                    : `skewX(${purplePos.bodySkew || 0}deg)`,
              transformOrigin: 'bottom center',
            }}
          >
            <div
              className="absolute flex gap-8 transition-all duration-700 ease-in-out"
              style={{
                left:
                  showPassword
                    ? '20px'
                    : isLookingAtEachOther
                      ? '55px'
                      : `${45 + purplePos.faceX}px`,
                top:
                  showPassword
                    ? '35px'
                    : isLookingAtEachOther
                      ? '65px'
                      : `${40 + purplePos.faceY}px`,
              }}
            >
              <EyeBall
                size={18}
                pupilSize={7}
                maxDistance={5}
                eyeColor="white"
                pupilColor="#2D2D2D"
                isBlinking={isPurpleBlinking}
                forceLookX={
                  showPassword
                    ? isPurplePeeking ? 4 : -4
                    : isLookingAtEachOther ? 3 : undefined
                }
                forceLookY={
                  showPassword
                    ? isPurplePeeking ? 5 : -4
                    : isLookingAtEachOther ? 4 : undefined
                }
              />
              <EyeBall
                size={18}
                pupilSize={7}
                maxDistance={5}
                eyeColor="white"
                pupilColor="#2D2D2D"
                isBlinking={isPurpleBlinking}
                forceLookX={
                  showPassword
                    ? isPurplePeeking ? 4 : -4
                    : isLookingAtEachOther ? 3 : undefined
                }
                forceLookY={
                  showPassword
                    ? isPurplePeeking ? 5 : -4
                    : isLookingAtEachOther ? 4 : undefined
                }
              />
            </div>
          </div>

          <div
            ref={blackRef}
            className="absolute bottom-0 transition-all duration-700 ease-in-out"
            style={{
              left: '240px',
              width: '120px',
              height: '310px',
              backgroundColor: '#2D2D2D',
              borderRadius: '8px 8px 0 0',
              zIndex: 2,
              transform:
                showPassword
                  ? `skewX(0deg)`
                  : isLookingAtEachOther
                    ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                    : isTyping
                      ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`
                      : `skewX(${blackPos.bodySkew || 0}deg)`,
              transformOrigin: 'bottom center',
            }}
          >
            <div
              className="absolute flex gap-6 transition-all duration-700 ease-in-out"
              style={{
                left:
                  showPassword
                    ? '10px'
                    : isLookingAtEachOther
                      ? '32px'
                      : `${26 + blackPos.faceX}px`,
                top:
                  showPassword
                    ? '28px'
                    : isLookingAtEachOther
                      ? '12px'
                      : `${32 + blackPos.faceY}px`,
              }}
            >
              <EyeBall
                size={16}
                pupilSize={6}
                maxDistance={4}
                eyeColor="white"
                pupilColor="#2D2D2D"
                isBlinking={isBlackBlinking}
                forceLookX={showPassword ? -4 : isLookingAtEachOther ? 0 : undefined}
                forceLookY={showPassword ? -4 : isLookingAtEachOther ? -4 : undefined}
              />
              <EyeBall
                size={16}
                pupilSize={6}
                maxDistance={4}
                eyeColor="white"
                pupilColor="#2D2D2D"
                isBlinking={isBlackBlinking}
                forceLookX={showPassword ? -4 : isLookingAtEachOther ? 0 : undefined}
                forceLookY={showPassword ? -4 : isLookingAtEachOther ? -4 : undefined}
              />
            </div>
          </div>

          <div
            ref={orangeRef}
            className="absolute bottom-0 transition-all duration-700 ease-in-out"
            style={{
              left: '0px',
              width: '240px',
              height: '200px',
              zIndex: 3,
              backgroundColor: '#FF9B6B',
              borderRadius: '120px 120px 0 0',
              transform:
                showPassword
                  ? `skewX(0deg)`
                  : `skewX(${orangePos.bodySkew || 0}deg)`,
              transformOrigin: 'bottom center',
            }}
          >
            <div
              className="absolute flex gap-8 transition-all duration-200 ease-out"
              style={{
                left: showPassword ? '50px' : `${82 + (orangePos.faceX || 0)}px`,
                top: showPassword ? '85px' : `${90 + (orangePos.faceY || 0)}px`,
              }}
            >
              <Pupil
                size={12}
                maxDistance={5}
                pupilColor="#2D2D2D"
                forceLookX={showPassword ? -5 : undefined}
                forceLookY={showPassword ? -4 : undefined}
              />
              <Pupil
                size={12}
                maxDistance={5}
                pupilColor="#2D2D2D"
                forceLookX={showPassword ? -5 : undefined}
                forceLookY={showPassword ? -4 : undefined}
              />
            </div>
          </div>

          <div
            ref={yellowRef}
            className="absolute bottom-0 transition-all duration-700 ease-in-out"
            style={{
              left: '310px',
              width: '140px',
              height: '230px',
              backgroundColor: '#E8D754',
              borderRadius: '70px 70px 0 0',
              zIndex: 4,
              transform:
                showPassword
                  ? `skewX(0deg)`
                  : `skewX(${yellowPos.bodySkew || 0}deg)`,
              transformOrigin: 'bottom center',
            }}
          >
            <div
              className="absolute flex gap-6 transition-all duration-200 ease-out"
              style={{
                left: showPassword ? '20px' : `${52 + (yellowPos.faceX || 0)}px`,
                top: showPassword ? '35px' : `${40 + (yellowPos.faceY || 0)}px`,
              }}
            >
              <Pupil
                size={12}
                maxDistance={5}
                pupilColor="#2D2D2D"
                forceLookX={showPassword ? -5 : undefined}
                forceLookY={showPassword ? -4 : undefined}
              />
              <Pupil
                size={12}
                maxDistance={5}
                pupilColor="#2D2D2D"
                forceLookX={showPassword ? -5 : undefined}
                forceLookY={showPassword ? -4 : undefined}
              />
            </div>
            <div
              className="absolute h-[4px] w-20 rounded-full bg-[#2D2D2D] transition-all duration-200 ease-out"
              style={{
                left: showPassword ? '10px' : `${40 + (yellowPos.faceX || 0)}px`,
                top: showPassword ? '88px' : `${88 + (yellowPos.faceY || 0)}px`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="relative z-20 flex items-center gap-8 text-sm text-primary-foreground/60">
        {links.map((link, i) => (
          <button
            key={i}
            onClick={link.onClick}
            className="cursor-default hover:text-primary-foreground/90"
          >
            {link.text}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(0_0%_100%_/_0.05)_1px,transparent_1px),linear-gradient(90deg,hsl(0_0%_100%_/_0.05)_1px,transparent_1px)] bg-[length:20px_20px]" />
      <div className="absolute right-1/4 top-1/4 size-64 rounded-full bg-primary-foreground/10 blur-3xl" />
      <div className="absolute bottom-1/4 left-1/4 size-96 rounded-full bg-primary-foreground/5 blur-3xl" />
    </div>
  );
}

export default AnimatedCharacters;
