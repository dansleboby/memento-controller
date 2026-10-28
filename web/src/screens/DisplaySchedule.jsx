import { useRef, useState } from 'react';
import { DeviceRotate, FloppyDisk, Moon, MoonStars, Plus, Power, Shuffle, Sun, Timer, X } from '@phosphor-icons/react';
import * as api from '../api/client.js';
import { useConfig, useWriter } from './settingsHooks.js';

const TOGGLES = [
  { id: 'power', label: 'Alimentation', action: 'ChangePower', field: 'DisplayOn', Icon: Power },
  { id: 'shuffle', label: 'Lecture aléatoire', action: 'ChangeShuffle', field: 'ShuffleOn', Icon: Shuffle },
  { id: 'portrait', label: 'Mode portrait', action: 'ChangeOrientation', field: 'PortraitMode', Icon: DeviceRotate },
  { id: 'evening', label: 'Mode nuit (soirée)', action: 'ChangeEvening', field: 'NightModeOn', Icon: MoonStars },
];

// The frame's AwayDays enum, by index.
const AWAY_DAYS = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
  'Fin de semaine', 'Jours de semaine', 'Tous les jours',
];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MAX_AWAY_SLOTS = 7;
const NEW_SLOT = { day: 9, off: 23, on: 7 };

// Away slots are parallel arrays (AwayDay/AwayOffTime/AwayOnTime/AwayEnable), times in whole hours.
function readSlots(config) {
  const days = Array.isArray(config.AwayDay) ? config.AwayDay : [];
  return days.map((day, i) => ({
    day,
    off: config.AwayOffTime?.[i] ?? 0,
    on: config.AwayOnTime?.[i] ?? 0,
    disabled: config.AwayEnable?.[i] === false,
  }));
}

function HourSelect({ label, value, onChange, Icon }) {
  return (
    <label>
      <Icon size={18} weight="light" aria-hidden="true" />
      {label.replace(/ \(.*\)$/, '')}
      <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, '0')}:00
          </option>
        ))}
      </select>
    </label>
  );
}

function AwaySchedule({ config }) {
  const nextId = useRef(0);
  const withId = (slot) => ({ ...slot, id: nextId.current++ });
  const [slots, setSlots] = useState(() => readSlots(config).map(withId));
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const hasDisabled = readSlots(config).some((s) => s.disabled);

  const update = (id, patch) => setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  async function save() {
    setStatus(null);
    setError(null);
    try {
      await api.setAwaySchedule(slots.map(({ day, off, on }) => ({ day, off, on })));
      setStatus('Horaire enregistré.');
    } catch (e) {
      setError(`Échec de l'enregistrement : ${e.message}`);
    }
  }

  return (
    <section aria-labelledby="away-title" className="panel panel-padded">
      <div>
        <h3 id="away-title">Horaire d'absence</h3>
        <p className="muted">L'écran s'éteint pendant chaque créneau.</p>
      </div>
      {hasDisabled && (
        <p className="note">
          Un créneau marqué désactivé s'applique quand même sur ce cadre : retire-le pour l'arrêter.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {slots.length ? (
        <ul className="slot-list">
          {slots.map((slot, i) => {
            const n = i + 1;
            return (
              <li key={slot.id} className="slot">
                <label>
                  Jours
                  <select
                    aria-label={`Jours (créneau ${n})`}
                    value={slot.day}
                    onChange={(e) => update(slot.id, { day: Number(e.target.value) })}
                  >
                    {AWAY_DAYS.map((label, day) => (
                      <option key={day} value={day}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <HourSelect
                  label={`Extinction (créneau ${n})`}
                  Icon={Moon}
                  value={slot.off}
                  onChange={(off) => update(slot.id, { off })}
                />
                <HourSelect
                  label={`Rallumage (créneau ${n})`}
                  Icon={Sun}
                  value={slot.on}
                  onChange={(on) => update(slot.id, { on })}
                />
                <button
                  type="button"
                  className="btn-icon btn-sm btn-ghost"
                  aria-label={`Retirer le créneau ${n}`}
                  title="Retirer"
                  onClick={() => setSlots((prev) => prev.filter((s) => s.id !== slot.id))}
                >
                  <X size={18} weight="light" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Aucun créneau : l'écran ne s'éteint jamais selon l'horaire.</p>
      )}
      <div className="button-row">
        <button
          type="button"
          disabled={slots.length >= MAX_AWAY_SLOTS}
          onClick={() => setSlots((prev) => [...prev, withId(NEW_SLOT)])}
        >
          <Plus size={18} weight="light" aria-hidden="true" />
          Ajouter un créneau
        </button>
        <button type="button" className="btn-primary" onClick={save}>
          <FloppyDisk size={18} weight="light" aria-hidden="true" />
          Enregistrer l'horaire
        </button>
      </div>
      {status && <p role="status">{status}</p>}
    </section>
  );
}

function Form({ config }) {
  const { write, writeDebounced, error } = useWriter();
  const [toggles, setToggles] = useState(() =>
    Object.fromEntries(TOGGLES.map((t) => [t.id, Boolean(config[t.field])])),
  );
  const [duration, setDuration] = useState(config.DisplayTime ?? '');

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <div className="panel">
        {TOGGLES.map((t) => (
          <label key={t.id} className="switch-row">
            <span>
              <span className="row-icon">
                <t.Icon size={18} weight="light" aria-hidden="true" />
              </span>
              {t.label}
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={toggles[t.id]}
              onChange={(e) => {
                const v = e.target.checked;
                setToggles((prev) => ({ ...prev, [t.id]: v }));
                write(t.action, v);
              }}
            />
          </label>
        ))}
        <div className="field-row">
          <label htmlFor="duration">
            <span className="row-icon">
              <Timer size={18} weight="light" aria-hidden="true" />
            </span>
            Durée par image (s)
          </label>
          <input
          id="duration"
          type="number"
          min={1}
          value={duration}
          onChange={(e) => {
            setDuration(e.target.value);
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n > 0) writeDebounced('ChangePictureDuration', n);
          }}
          />
        </div>
      </div>
      <AwaySchedule config={config} />
    </>
  );
}

export default function DisplaySchedule() {
  const { config, error } = useConfig();
  return (
    <section aria-label="Affichage et horaire" className="screen">
      <div className="screen-head">
        <h2>Affichage</h2>
      </div>
      {error && <p role="alert">{error}</p>}
      {config || error ? <Form config={config || {}} /> : <p className="muted">Chargement...</p>}
    </section>
  );
}
