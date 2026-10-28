import { useState } from 'react';
import { CloudArrowUp } from '@phosphor-icons/react';

export default function UploadDropzone({ onFiles, disabled }) {
  const [over, setOver] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length && !disabled) onFiles(files);
  }

  function handlePick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) onFiles(files);
  }

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      data-testid="dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <CloudArrowUp size={30} weight="light" aria-hidden="true" />
      <p>Glissez des images ici ou</p>
      <label className="btn btn-primary">
        Importer des images
        <input
          className="visually-hidden"
          type="file"
          accept="image/*"
          multiple
          disabled={disabled}
          onChange={handlePick}
        />
      </label>
    </div>
  );
}
