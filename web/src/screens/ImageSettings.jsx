import { useState } from 'react';
import { ArrowCounterClockwise, Sun, SunDim } from '@phosphor-icons/react';
import { useConfig, useWriter } from './settingsHooks.js';
import { useT } from '../i18n/index.jsx';

// Config.Brightness is the 11-point ambient-light curve, not a level: the frame only
// takes relative nudges at the current light level, or this sentinel to reset the curve.
const BRIGHTNESS_STEP = 10;
const BRIGHTNESS_RESET = 305419896;
const BRIGHTNESS_BUTTONS = [
  { label: 'image.dimmer', value: -BRIGHTNESS_STEP, Icon: SunDim },
  { label: 'image.brighter', value: BRIGHTNESS_STEP, Icon: Sun },
  { label: 'image.brightnessReset', value: BRIGHTNESS_RESET, Icon: ArrowCounterClockwise },
];

const SLIDERS = [
  { id: 'contrast', label: 'image.contrast', action: 'ChangeContrast', field: 'ContrastOffset', track: 'linear-gradient(90deg, #d6d0ca, #3a3532)' },
  { id: 'exposure', label: 'image.exposure', action: 'ChangeExposure', field: 'ExposureOffset', track: 'linear-gradient(90deg, #3a3532, #efe6d2)' },
  { id: 'saturation', label: 'image.saturation', action: 'ChangeSaturation', field: 'SaturationOffset', track: 'linear-gradient(90deg, #bdb7b1, #b9644f)' },
  { id: 'temperature', label: 'image.temperature', action: 'ChangeTemperature', field: 'TemperatureOffset', track: 'linear-gradient(90deg, #8fb3c6, #ece6dc, #d6a06c)' },
  { id: 'threshold', label: 'image.threshold', action: 'ChangeThreshold', field: 'OffThresholdOffset', track: 'linear-gradient(90deg, #2a2725, #a8a09a)' },
];

// The frame reports only the current table name; these are its SetupData.ms_Calibration* constants,
// and it falls back to Standard for anything else.
const CALIBRATION_TABLES = ['Darker', 'Dark', 'Standard', 'Bright', 'Brighter', 'Vivid'];

function Form({ config }) {
  const t = useT();
  const { write, writeDebounced, error } = useWriter();
  const [values, setValues] = useState(() =>
    Object.fromEntries(SLIDERS.map((s) => [s.id, Number(config[s.field] ?? 0)])),
  );
  const [calibration, setCalibration] = useState(config.CalibrationTableName ?? 'Standard');

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <div className="panel">
        <div className="field-row" role="group" aria-label={t('image.brightness')}>
          <span className="field-label">{t('image.brightness')}</span>
          <div className="button-row">
            {BRIGHTNESS_BUTTONS.map(({ label, value, Icon }) => (
              <button key={label} type="button" className="btn-sm" onClick={() => write('ChangeBrightness', value)}>
                <Icon size={18} weight="light" aria-hidden="true" />
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        {SLIDERS.map((s) => (
          <div key={s.id} className="field-row">
            <label htmlFor={s.id}>{t(s.label)}</label>
            <input
              id={s.id}
              type="range"
              min={-100}
              max={100}
              value={values[s.id]}
              style={{ '--track': s.track }}
              onChange={(e) => {
                const v = Number(e.target.value);
                setValues((prev) => ({ ...prev, [s.id]: v }));
                writeDebounced(s.action, v);
              }}
            />
            <output htmlFor={s.id} className="value-bubble">
              {values[s.id]}
            </output>
          </div>
        ))}
        <div className="field-row">
          <label htmlFor="calibration">{t('image.calibration')}</label>
          <select
            id="calibration"
            value={calibration}
            onChange={(e) => {
              setCalibration(e.target.value);
              write('ChangeCalibration', e.target.value);
            }}
          >
            {CALIBRATION_TABLES.map((value) => (
              <option key={value} value={value}>
                {t(`calibration.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

export default function ImageSettings() {
  const t = useT();
  const { config, error } = useConfig();
  return (
    <section aria-label={t('image.aria')} className="screen">
      <div className="screen-head">
        <div>
          <h2>{t('image.title')}</h2>
          <p>{t('image.lede')}</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {config || error ? <Form config={config || {}} /> : <p className="muted">{t('common.loading')}</p>}
    </section>
  );
}
