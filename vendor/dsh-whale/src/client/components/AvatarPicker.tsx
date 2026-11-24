// Orca-faithful AvatarPicker: 3D circular mascot WebP carousel, 11-color swatches + custom hex,
// 512x512 PNG upload/drop/paste cropper, and edge-color extraction for NewBotDialog banner.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopoverDismiss } from './useAnchoredPopoverDismiss';
import {
  BOT_AVATAR_SOURCE_TYPES,
  MAX_BOT_AVATAR_SOURCE_BYTES,
  MIN_BOT_AVATAR_SOURCE_SIDE,
  PICKABLE_BOT_MASCOT_IDS,
  WHALE_BOT_MASCOT_IDS,
  WHALE_MASCOT_LABELS,
  mascotAvatar,
  parseBotAvatar,
} from '../../shared/bot-avatar.js';
import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_COLOR_NAMES,
  DEFAULT_BOT_AVATAR_COLOR,
  isDarkBotAvatarColor,
  normalizeHexColor,
} from '../../shared/bot-avatar-color.js';
import { useBotsLocale } from '../store/bots-store';
import { mascotAssetUrl } from '../store/rpc';
import { IconChevronLeft, IconChevronRight, IconUndo, IconUpload } from './Icons';

export interface CroppedAvatarImage {
  dataUrl: string;
  base64Png: string;
  edgeColor: string;
}

export interface AvatarPickerValue {
  avatar: string;
  avatarColor: string;
  uploadedImage?: CroppedAvatarImage | null;
}

export interface AvatarPickerProps {
  value: AvatarPickerValue;
  onChange: (next: AvatarPickerValue) => void;
  onUploadCommit?: (image: CroppedAvatarImage) => Promise<void> | void;
  showUpload?: boolean;
  className?: string;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function extractEdgeColorFromCanvas(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return DEFAULT_BOT_AVATAR_COLOR;
  }
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(width / 32));
  const sample = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] < 32) {
      return;
    }
    rSum += data[idx];
    gSum += data[idx + 1];
    bSum += data[idx + 2];
    count += 1;
  };
  for (let x = 0; x < width; x += step) {
    sample(x, 2);
    sample(x, height - 3);
  }
  for (let y = 0; y < height; y += step) {
    sample(2, y);
    sample(width - 3, y);
  }
  if (count === 0) {
    return DEFAULT_BOT_AVATAR_COLOR;
  }
  return rgbToHex(rSum / count, gSum / count, bSum / count);
}

function loadFileAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode image file.'));
    };
    img.src = objectUrl;
  });
}

export async function cropImageFileToPng512(file: File): Promise<CroppedAvatarImage> {
  if (!BOT_AVATAR_SOURCE_TYPES.has(file.type)) {
    throw new Error('Use a PNG, JPEG, WebP, GIF, or AVIF image (SVG is not supported).');
  }
  if (file.size > MAX_BOT_AVATAR_SOURCE_BYTES) {
    throw new Error('Image must be 10 MB or smaller.');
  }
  const img = await loadFileAsImage(file);
  if (img.naturalWidth < MIN_BOT_AVATAR_SOURCE_SIDE || img.naturalHeight < MIN_BOT_AVATAR_SOURCE_SIDE) {
    throw new Error(`Image must be at least ${MIN_BOT_AVATAR_SOURCE_SIDE}x${MIN_BOT_AVATAR_SOURCE_SIDE}px.`);
  }
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = Math.floor((img.naturalWidth - side) / 2);
  const sy = Math.floor((img.naturalHeight - side) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  ctx.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
  const dataUrl = canvas.toDataURL('image/png');
  const base64Png = dataUrl.replace(/^data:image\/png;base64,/, '');
  const edgeColor = extractEdgeColorFromCanvas(canvas);
  return { dataUrl, base64Png, edgeColor };
}

interface SlideItem {
  key: string;
  kind: 'mascot' | 'upload';
  mascotId?: string;
  dataUrl?: string;
}

function circularDelta(index: number, active: number, length: number): number {
  let delta = index - active;
  const half = length / 2;
  if (delta > half) {
    delta -= length;
  } else if (delta < -half) {
    delta += length;
  }
  return delta;
}

function MascotWebpTile({ mascotId, color }: { mascotId: string; color: string }) {
  const dark = isDarkBotAvatarColor(color);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: color }}>
      {dark && (
        <img
          src={mascotAssetUrl(mascotId, 'rim')}
          alt=""
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      <img
        src={mascotAssetUrl(mascotId, 'webp')}
        alt={mascotId}
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  );
}

type MascotGroup = 'whale' | 'all';

const WHALE_MASCOT_LABELS_EN: Record<string, string> = {
  W1: 'Whale Chan',
  W2: 'Blue Whale',
  W3: 'Coder Whale',
  W4: 'Crown Whale',
  W5: 'Sailor Whale',
  W6: 'Foodie Whale',
  W7: 'Starry Whale',
  W8: 'Chibi Whale',
};

function isWhaleMascotId(id: string | null | undefined): boolean {
  return Boolean(id && (WHALE_BOT_MASCOT_IDS as readonly string[]).includes(id));
}

function mascotCaption(slide: SlideItem | undefined, locale: string): string {
  const zh = locale === 'zh-CN';
  if (!slide) {
    return '';
  }
  if (slide.kind === 'upload') {
    return zh ? '自定义头像' : 'Custom avatar';
  }
  const id = slide.mascotId ?? 'W1';
  if (zh) {
    const label = (WHALE_MASCOT_LABELS as Record<string, string>)[id];
    return label ?? `萌宠 ${id}`;
  }
  return WHALE_MASCOT_LABELS_EN[id] ?? `Mascot ${id}`;
}

export function AvatarPicker({
  value,
  onChange,
  onUploadCommit,
  showUpload = true,
  className,
}: AvatarPickerProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const parsed = parseBotAvatar(value.avatar);
  const parsedKind = parsed?.kind ?? null;
  const parsedMascotId = parsed?.kind === 'mascot' ? parsed.id : null;

  const [group, setGroup] = useState<MascotGroup>(() => (
    parsedMascotId && !isWhaleMascotId(parsedMascotId) ? 'all' : 'whale'
  ));
  const [error, setError] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<AvatarPickerValue | null>(null);

  const normalizedColor = normalizeHexColor(value.avatarColor) ?? DEFAULT_BOT_AVATAR_COLOR;
  const [customHexText, setCustomHexText] = useState(normalizedColor);

  useEffect(() => {
    setCustomHexText(normalizedColor);
  }, [normalizedColor]);

  useEffect(() => () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
  }, []);

  const slides = useMemo<SlideItem[]>(() => {
    const ids = group === 'whale' ? WHALE_BOT_MASCOT_IDS : PICKABLE_BOT_MASCOT_IDS;
    const list: SlideItem[] = ids.map((id) => ({
      key: `mascot:${id}`,
      kind: 'mascot',
      mascotId: id,
    }));
    if (value.uploadedImage?.dataUrl) {
      list.unshift({
        key: 'upload:custom',
        kind: 'upload',
        dataUrl: value.uploadedImage.dataUrl,
      });
    }
    return list;
  }, [group, value.uploadedImage?.dataUrl]);

  const activeIndex = useMemo(() => {
    if (value.uploadedImage?.dataUrl && parsedKind === 'upload') {
      return 0;
    }
    if (parsedMascotId) {
      const idx = slides.findIndex((slide) => slide.mascotId === parsedMascotId);
      if (idx >= 0) {
        return idx;
      }
    }
    return value.uploadedImage?.dataUrl ? 1 : 0;
  }, [parsedKind, parsedMascotId, slides, value.uploadedImage?.dataUrl]);

  const handleGroupSwitch = (nextGroup: MascotGroup) => {
    setGroup(nextGroup);
    if (nextGroup === 'whale' && parsedKind !== 'upload' && !isWhaleMascotId(parsedMascotId)) {
      onChange({
        avatar: mascotAvatar(WHALE_BOT_MASCOT_IDS[0] ?? 'W1'),
        avatarColor: normalizedColor,
        uploadedImage: value.uploadedImage,
      });
    }
  };

  const selectIndex = useCallback((nextIdx: number) => {
    const wrapped = ((nextIdx % slides.length) + slides.length) % slides.length;
    const target = slides[wrapped];
    if (!target) {
      return;
    }
    if (target.kind === 'upload' && value.uploadedImage) {
      onChange({
        avatar: 'upload:pending',
        avatarColor: value.uploadedImage.edgeColor || normalizedColor,
        uploadedImage: value.uploadedImage,
      });
    } else if (target.mascotId) {
      onChange({
        avatar: mascotAvatar(target.mascotId),
        avatarColor: normalizedColor,
        uploadedImage: value.uploadedImage,
      });
    }
  }, [normalizedColor, onChange, slides, value.uploadedImage]);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    const snapshot = { ...value };
    try {
      const cropped = await cropImageFileToPng512(file);
      onChange({
        avatar: 'upload:pending',
        avatarColor: cropped.edgeColor,
        uploadedImage: cropped,
      });
      if (onUploadCommit) {
        await onUploadCommit(cropped);
      }
      setUndoSnapshot(snapshot);
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
      undoTimerRef.current = window.setTimeout(() => {
        setUndoSnapshot(null);
        undoTimerRef.current = null;
      }, 8000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [onChange, onUploadCommit, value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectIndex(activeIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectIndex(activeIndex + 1);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingFile(false);
    const file = event.dataTransfer.files?.[0];
    if (file && showUpload) {
      void processFile(file);
    }
  };

  const handleColorPick = (hex: string) => {
    const valid = normalizeHexColor(hex);
    if (!valid) {
      return;
    }
    onChange({
      ...value,
      avatarColor: valid,
    });
  };

  const activeSlide = slides[activeIndex];
  const isUploadSelected = activeSlide?.kind === 'upload';
  const currentCaption = mascotCaption(activeSlide, locale);

  return (
    <div
      className={`dsh-bots-picker ${className ?? ''}`.trim()}
      data-drag-file={draggingFile ? 'true' : 'false'}
      onKeyDown={handleKeyDown}
      onDragOver={(e) => {
        if (showUpload) {
          e.preventDefault();
          setDraggingFile(true);
        }
      }}
      onDragLeave={() => setDraggingFile(false)}
      onDrop={handleDrop}
      tabIndex={0}
    >
      <div className="dsh-bots-picker-head">
        <div className="dsh-bots-picker-seg" role="group" aria-label={zh ? '头像分组' : 'Avatar group'}>
          <button
            type="button"
            className="dsh-bots-picker-seg-btn"
            aria-pressed={group === 'whale'}
            onClick={() => handleGroupSwitch('whale')}
          >
            {zh ? `大肥鱼 (${WHALE_BOT_MASCOT_IDS.length})` : `Whales (${WHALE_BOT_MASCOT_IDS.length})`}
          </button>
          <button
            type="button"
            className="dsh-bots-picker-seg-btn"
            aria-pressed={group === 'all'}
            onClick={() => handleGroupSwitch('all')}
          >
            {zh ? '全部萌宠' : 'All mascots'}
          </button>
        </div>
        <span className="dsh-bots-picker-caption" title={currentCaption}>
          {currentCaption}
        </span>
      </div>

      <div className="dsh-bots-carousel" aria-label={tr('bots.new.picture', 'Picture')}>
        <button
          type="button"
          className="dsh-bots-carousel-nav"
          data-dir="prev"
          onClick={() => selectIndex(activeIndex - 1)}
          aria-label="Previous avatar"
        >
          <IconChevronLeft size={15} />
        </button>

        {slides.map((slide, idx) => {
          const delta = circularDelta(idx, activeIndex, slides.length);
          if (Math.abs(delta) > 2) {
            return null;
          }
          const isCenter = delta === 0;
          const tx = delta * 104;
          const scale = isCenter ? 1 : Math.abs(delta) === 1 ? 72 / 112 : 0.45;
          const opacity = isCenter ? 1 : Math.abs(delta) === 1 ? 0.4 : 0;
          return (
            <div
              key={slide.key}
              className="dsh-bots-carousel-slide"
              onClick={() => selectIndex(idx)}
              style={{
                transform: `translateX(${tx}px) scale(${scale})`,
                opacity,
                zIndex: isCenter ? 5 : 3 - Math.abs(delta),
                pointerEvents: Math.abs(delta) <= 1 ? 'auto' : 'none',
              }}
            >
              {slide.kind === 'upload' && slide.dataUrl ? (
                <img
                  src={slide.dataUrl}
                  alt="Custom avatar"
                  draggable={false}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <MascotWebpTile mascotId={slide.mascotId ?? 'W1'} color={normalizedColor} />
              )}
            </div>
          );
        })}

        <button
          type="button"
          className="dsh-bots-carousel-nav"
          data-dir="next"
          onClick={() => selectIndex(activeIndex + 1)}
          aria-label="Next avatar"
        >
          <IconChevronRight size={15} />
        </button>
      </div>

      {!isUploadSelected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', fontWeight: 500 }}>
            {tr('bots.new.pictureColor', 'Background color')}
          </div>
          <div className="dsh-bots-swatches">
            {BOT_AVATAR_COLORS.map((hex) => {
              const nameKey = BOT_AVATAR_COLOR_NAMES[hex as keyof typeof BOT_AVATAR_COLOR_NAMES];
              const label = nameKey ? tr(nameKey, hex) : hex;
              return (
                <button
                  key={hex}
                  type="button"
                  className="dsh-bots-swatch"
                  data-selected={normalizedColor === hex ? 'true' : 'false'}
                  style={{ backgroundColor: hex }}
                  title={label}
                  aria-label={label}
                  onClick={() => handleColorPick(hex)}
                />
              );
            })}
            <label
              className="dsh-bots-swatch dsh-bots-swatch-wheel"
              title={tr('bots.new.pictureColorCustom', 'Custom color')}
            >
              <input
                type="color"
                value={normalizedColor}
                onChange={(e) => handleColorPick(e.target.value)}
                style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                aria-label={tr('bots.new.pictureColorCustom', 'Custom color')}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="text"
              className="dsh-bots-input"
              value={customHexText}
              onChange={(e) => {
                setCustomHexText(e.target.value);
                const valid = normalizeHexColor(e.target.value);
                if (valid) {
                  handleColorPick(valid);
                }
              }}
              placeholder="#b3dbf4"
              maxLength={7}
              style={{ height: 28, fontSize: 12, lineHeight: '18px', width: 96, padding: '2px 8px', fontFamily: 'var(--ds-font-family-code)' }}
            />
          </div>
        </div>
      )}

      {showUpload && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept={[...BOT_AVATAR_SOURCE_TYPES].join(',')}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void processFile(file);
              }
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="dsh-bots-btn"
            data-size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <IconUpload size={13} />
            <span>{zh ? '上传图片' : 'Upload image'}</span>
          </button>
          <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
            {zh ? '支持拖放或 Ctrl+V 粘贴' : 'Drop or paste image'}
          </span>
        </div>
      )}

      {undoSnapshot && (
        <div className="dsh-bots-search-banner" style={{ margin: 0 }}>
          <span>{zh ? '图片已更新' : 'Picture updated'}</span>
          <button
            type="button"
            className="dsh-bots-link-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={() => {
              onChange(undoSnapshot);
              setUndoSnapshot(null);
            }}
          >
            <IconUndo size={11} />
            <span>{tr('settings.bots.memoryUndo', 'Undo')}</span>
          </button>
        </div>
      )}

      {error && (
        <div className="dsh-bots-error-text">{error}</div>
      )}
    </div>
  );
}

export interface AvatarPickerPopoverProps extends AvatarPickerProps {
  open: boolean;
  anchorRect: DOMRect | null;
  triggerRef?: RefObject<HTMLElement | null>;
  triggerEl?: HTMLElement | null;
  onClose: () => void;
}

/** 12 swatches × 22px + 11 × 5px gap fit one row inside 352 − 2×12px padding − 2px border. */
const AVATAR_PICKER_POPOVER_WIDTH = 352;

export function AvatarPickerPopover({
  open,
  anchorRect,
  triggerRef,
  triggerEl,
  onClose,
  ...pickerProps
}: AvatarPickerPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useAnchoredPopoverDismiss({
    open,
    popoverRef: ref,
    triggerRef,
    triggerEl,
    onClose,
  });

  if (!open || !anchorRect || typeof document === 'undefined') {
    return null;
  }

  const popoverWidth = AVATAR_PICKER_POPOVER_WIDTH;
  const left = Math.max(12, Math.min(anchorRect.left, window.innerWidth - popoverWidth - 12));
  const top = Math.max(12, Math.min(anchorRect.bottom + 8, window.innerHeight - 390));

  return createPortal(
    <div
      ref={ref}
      className="dsh-bots-popover"
      data-dsh-bots-popover="avatar-picker"
      style={{ left, top, padding: 0, width: popoverWidth, boxSizing: 'border-box' }}
    >
      <AvatarPicker {...pickerProps} />
    </div>,
    document.body,
  );
}
