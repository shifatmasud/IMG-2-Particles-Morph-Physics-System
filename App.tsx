import React, { useState, useCallback } from 'react';
import ImageParticleEffect from './components/ImageParticleEffect.tsx';

const App = () => {
  const [sourceImageUrl, setSourceImageUrl] = useState<string>('https://i.imgur.com/8J0oT3b.png');
  const [currentImageUrl, setCurrentImageUrl] = useState<string>(sourceImageUrl);
  const [targetImageUrl, setTargetImageUrl] = useState<string | null>(null);
  const [morphDirection, setMorphDirection] = useState<'toTarget' | 'toSource' | null>(null);
  const [isMorphing, setIsMorphing] = useState(false);

  const handleSourceImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        const newSourceUrl = reader.result as string;
        setSourceImageUrl(newSourceUrl);
        setCurrentImageUrl(newSourceUrl);
        setTargetImageUrl(null);
        setMorphDirection(null);
        setIsMorphing(false);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleTargetImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setTargetImageUrl(reader.result as string);
        setMorphDirection(null); // Reset direction when a new target is chosen
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleToggleMorph = useCallback(() => {
    if (!targetImageUrl || isMorphing) return;
    setIsMorphing(true);
    if (currentImageUrl === sourceImageUrl) {
      setMorphDirection('toTarget');
    } else {
      setMorphDirection('toSource');
    }
  }, [targetImageUrl, isMorphing, currentImageUrl, sourceImageUrl]);


  const handleMorphComplete = useCallback((direction: 'toTarget' | 'toSource') => {
    if (direction === 'toTarget' && targetImageUrl) {
      setCurrentImageUrl(targetImageUrl);
    } else if (direction === 'toSource') {
      setCurrentImageUrl(sourceImageUrl);
    }
    setIsMorphing(false);
    setMorphDirection(null);
  }, [targetImageUrl, sourceImageUrl]);
  
  const buttonStyle: React.CSSProperties = {
    cursor: 'pointer',
    padding: '10px 20px',
    backgroundColor: '#333',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    transition: 'background-color 0.2s, opacity 0.2s',
    marginRight: '10px',
    fontSize: '0.9rem',
    minWidth: '140px',
    textAlign: 'center',
  };

  const disabledButtonStyle: React.CSSProperties = { ...buttonStyle, cursor: 'not-allowed', opacity: 0.5 };

  const canMorph = !isMorphing && targetImageUrl;
  const morphButtonText = currentImageUrl === sourceImageUrl ? 'Morph to Target' : 'Morph to Source';


  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: '#111111', color: '#eee', fontFamily: 'sans-serif' }}>
      <header style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, maxWidth: 'calc(100% - 40px)' }}>
        <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 600 }}>Image to Fluid Particles</h1>
        <p style={{ margin: '8px 0 16px', fontSize: '1rem', color: '#aaa' }}>Upload images and watch them morph back and forth.</p>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          
          <label htmlFor="imageUpload" style={buttonStyle} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#555'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#333'}>
            Source Image
          </label>
          <input id="imageUpload" type="file" accept="image/*" aria-label="Upload a source image" onChange={handleSourceImageUpload} style={{ display: 'none' }} />
          
          <label htmlFor="targetImageUpload" style={buttonStyle} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#555'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#333'}>
            Target Image
          </label>
          <input id="targetImageUpload" type="file" accept="image/*" aria-label="Upload a target image" onChange={handleTargetImageUpload} style={{ display: 'none' }} />

          <button onClick={handleToggleMorph} style={canMorph ? buttonStyle : disabledButtonStyle} disabled={!canMorph}>
            {morphButtonText}
          </button>
          
          {targetImageUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#222', padding: '5px 10px', borderRadius: '8px' }}>
              <span style={{fontSize: '0.9rem'}}>Target:</span>
              <img src={targetImageUrl} alt="Target Preview" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
            </div>
          )}
        </div>
      </header>
      <main>
        <ImageParticleEffect 
            key={sourceImageUrl}
            sourceImageUrl={sourceImageUrl} 
            targetImageUrl={targetImageUrl} 
            morphDirection={morphDirection} 
            onMorphComplete={handleMorphComplete} 
        />
      </main>
    </div>
  );
};

export default App;