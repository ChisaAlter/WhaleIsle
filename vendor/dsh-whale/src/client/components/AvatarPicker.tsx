// Orca-faithful AvatarPicker: 3D circular mascot WebP carousel, transparent + 11-color swatches + custom hex,
// 512x512 PNG upload/drop/paste cropper, and edge-color extraction for NewBotDialog banner.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
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
  WHALE_MASCOT_LABELS_EN,
  mascotAvatar,
  parseBotAvatar,
  recommendedMascotColor,
} from '../../shared/bot-avatar.js';
import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_COLOR_NAMES,
  DEFAULT_BOT_AVATAR_COLOR,
  TRANSPARENT_BOT_AVATAR_COLOR,
  isDarkBotAvatarColor,
  isTransparentBotAvatarColor,
  normalizeBotAvatarColor,
  normalizeHexColor,
} from '../../shared/bot-avatar-color.js';
import { useBotsLocale } from '../store/bots-store';
import { mascotAssetUrl, readUploadedAvatarDataUrl } from '../store/rpc';
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
  botId?: string | null;
  hasExplicitColor?: boolean;
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
    return TRANSPARENT_BOT_AVATAR_COLOR;
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
  uploadAvatar?: string;
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
  const transparent = isTransparentBotAvatarColor(color);
  const dark = !transparent && isDarkBotAvatarColor(color);
  return (
    <div
      data-transparent={transparent ? 'true' : 'false'}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: transparent ? 'transparent' : color,
      }}
    >
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
  const labelEn = (WHALE_MASCOT_LABELS_EN as Record<string, string>)[id];
  return labelEn ?? `Mascot ${id}`;
}

export function AvatarPicker({
  value,
  onChange,
  onUploadCommit,
  botId,
  hasExplicitColor,
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
  const parsedVersion = parsed?.kind === 'upload' ? parsed.version : null;

  const [group, setGroup] = useState<MascotGroup>(() => (
    parsedMascotId && !isWhaleMascotId(parsedMascotId) ? 'all' : 'whale'
  ));
  const [error, setError] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<AvatarPickerValue | null>(null);
  const [persistedUpload, setPersistedUpload] = useState<{ avatar: string; dataUrl: string } | null>(null);
  const [localUpload, setLocalUpload] = useState<CroppedAvatarImage | null>(null);
  const [pendingUpload, setPendingUpload] = useState(false);

  const normalizedColor = normalizeBotAvatarColor(value.avatarColor) ?? DEFAULT_BOT_AVATAR_COLOR;
  const isTransparent = isTransparentBotAvatarColor(normalizedColor);
  const hasExplicitColorRef = useRef(Boolean(hasExplicitColor));
  const lastHexColorRef = useRef(normalizeHexColor(normalizedColor) ?? DEFAULT_BOT_AVATAR_COLOR);
  const [customHexText, setCustomHexText] = useState(isTransparent ? '' : normalizedColor);

  useEffect(() => {
    const hex = normalizeHexColor(normalizedColor);
    if (hex) {
      lastHexColorRef.current = hex;
    }
    setCustomHexText(isTransparent ? '' : normalizedColor);
  }, [isTransparent, normalizedColor]);

  useEffect(() => {
    if (parsedKind === 'upload' && parsedVersion && parsedVersion !== 'pending') {
      setPendingUpload(false);
    }
  }, [parsedKind, parsedVersion]);

  useEffect(() => {
    if (!botId || parsedKind !== 'upload' || !parsedVersion || parsedVersion === 'pending') {
      return undefined;
    }
    if (persistedUpload?.avatar === value.avatar) {
      return undefined;
    }
    let cancelled = false;
    void readUploadedAvatarDataUrl(botId, parsedVersion).then((dataUrl) => {
      if (!cancelled && dataUrl) {
        setPersistedUpload({ avatar: value.avatar, dataUrl });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [botId, parsedKind, parsedVersion, persistedUpload?.avatar, value.avatar]);

  useEffect(() => () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
  }, []);

  const effectiveUploadedImage = value.uploadedImage ?? localUpload;
  const effectiveUploadDataUrl = value.uploadedImage?.dataUrl ?? localUpload?.dataUrl ?? persistedUpload?.dataUrl ?? null;
  const committedUploadAvatar = parsedKind === 'upload' && parsedVersion && parsedVersion !== 'pending'
    ? value.avatar
    : persistedUpload?.avatar;
  const effectiveUploadAvatar = value.uploadedImage?.dataUrl
    ? 'upload:pending'
    : (committedUploadAvatar ?? 'upload:pending');

  const slides = useMemo<SlideItem[]>(() => {
    const ids = group === 'whale' ? WHALE_BOT_MASCOT_IDS : PICKABLE_BOT_MASCOT_IDS;
    const list: SlideItem[] = ids.map((id) => ({
      key: `mascot:${id}`,
      kind: 'mascot',
      mascotId: id,
    }));
    if (effectiveUploadDataUrl) {
      list.unshift({
        key: 'upload:custom',
        kind: 'upload',
        dataUrl: effectiveUploadDataUrl,
        uploadAvatar: effectiveUploadAvatar,
      });
    }
    return list;
  }, [effectiveUploadAvatar, effectiveUploadDataUrl, group]);

  const isUploadActive = pendingUpload || parsedKind === 'upload';

  const activeIndex = useMemo(() => {
    if (effectiveUploadDataUrl && isUploadActive) {
      return 0;
    }
    if (parsedMascotId) {
      const idx = slides.findIndex((slide) => slide.mascotId === parsedMascotId);
      if (idx >= 0) {
        return idx;
      }
    }
    return effectiveUploadDataUrl ? 1 : 0;
  }, [effectiveUploadDataUrl, isUploadActive, parsedMascotId, slides]);

  const handleGroupSwitch = (nextGroup: MascotGroup) => {
    setGroup(nextGroup);
    if (nextGroup === 'whale' && !isUploadActive && !isWhaleMascotId(parsedMascotId)) {
      const firstId = WHALE_BOT_MASCOT_IDS[0] ?? 'W1';
      onChange({
        avatar: mascotAvatar(firstId),
        avatarColor: hasExplicitColorRef.current ? normalizedColor : (recommendedMascotColor(firstId) ?? normalizedColor),
        uploadedImage: effectiveUploadedImage,
      });
    }
  };

  const selectIndex = useCallback((nextIdx: number) => {
    const wrapped = ((nextIdx % slides.length) + slides.length) % slides.length;
    const target = slides[wrapped];
    if (!target) {
      return;
    }
    setPendingUpload(false);
    if (target.kind === 'upload') {
      onChange({
        avatar: target.uploadAvatar ?? 'upload:pending',
        avatarColor: normalizedColor,
        uploadedImage: effectiveUploadedImage,
      });
    } else if (target.mascotId) {
      const nextColor = hasExplicitColorRef.current
        ? normalizedColor
        : (recommendedMascotColor(target.mascotId) ?? normalizedColor);
      onChange({
        avatar: mascotAvatar(target.mascotId),
        avatarColor: nextColor,
        uploadedImage: effectiveUploadedImage,
      });
    }
  }, [effectiveUploadedImage, normalizedColor, onChange, slides]);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    const snapshot = { ...value };
    try {
      const cropped = await cropImageFileToPng512(file);
      const nextColor = hasExplicitColorRef.current ? normalizedColor : cropped.edgeColor;
      setLocalUpload(cropped);
      setPendingUpload(true);
      onChange({
        avatar: 'upload:pending',
        avatarColor: nextColor,
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
      setPendingUpload(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [normalizedColor, onChange, onUploadCommit, value]);

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

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!showUpload) {
      return;
    }
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        event.stopPropagation();
        void processFile(file);
        return;
      }
    }
  };

  const handleColorPick = (rawColor: string) => {
    const valid = normalizeBotAvatarColor(rawColor);
    if (!valid) {
      return;
    }
    hasExplicitColorRef.current = true;
    onChange({
      ...value,
      avatar: pendingUpload ? 'upload:pending' : value.avatar,
      avatarColor: valid,
      uploadedImage: effectiveUploadedImage,
    });
  };

  const activeSlide = slides[activeIndex];
  const currentCaption = mascotCaption(activeSlide, locale);
  const transparentLabel = tr('bots.new.colorTransparent', zh ? '透明' : 'Transparent');

  return (
    <div
      className={`dsh-bots-picker ${className ?? ''}`.trim()}
      data-drag-file={draggingFile ? 'true' : 'false'}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
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
              data-transparent={isTransparent ? 'true' : 'false'}
              onClick={() => selectIndex(idx)}
              style={{
                transform: `translateX(${tx}px) scale(${scale})`,
                opacity,
                zIndex: isCenter ? 5 : 3 - Math.abs(delta),
                pointerEvents: Math.abs(delta) <= 1 ? 'auto' : 'none',
              }}
            >
              {slide.kind === 'upload' && slide.dataUrl ? (
                <div
                  data-transparent={isTransparent ? 'true' : 'false'}
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    backgroundColor: isTransparent ? 'transparent' : normalizedColor,
                  }}
                >
                  <img
                    src={slide.dataUrl}
                    alt="Custom avatar"
                    draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', fontWeight: 500 }}>
          {tr('bots.new.pictureColor', 'Background color')}
        </div>
        <div className="dsh-bots-swatches">
          {BOT_AVATAR_COLORS.map((color) => {
            const nameKey = BOT_AVATAR_COLOR_NAMES[color as keyof typeof BOT_AVATAR_COLOR_NAMES];
            const isSwatchTransparent = isTransparentBotAvatarColor(color);
            const label = nameKey
              ? tr(nameKey, isSwatchTransparent ? transparentLabel : color)
              : color;
            const selected = normalizedColor === color;
            return (
              <button
                key={color}
                type="button"
                className={isSwatchTransparent ? 'dsh-bots-swatch dsh-bots-swatch-transparent' : 'dsh-bots-swatch'}
                data-swatch={color}
                data-selected={selected ? 'true' : 'false'}
                aria-pressed={selected}
                style={isSwatchTransparent ? undefined : { backgroundColor: color }}
                title={label}
                aria-label={label}
                onClick={() => handleColorPick(color)}
              />
            );
          })}
          <label
            className="dsh-bots-swatch dsh-bots-swatch-wheel"
            title={tr('bots.new.pictureColorCustom', 'Custom color')}
          >
            <input
              type="color"
              value={isTransparent ? lastHexColorRef.current : normalizedColor}
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
              const valid = normalizeBotAvatarColor(e.target.value);
              if (valid) {
                handleColorPick(valid);
              }
            }}
            placeholder={isTransparent ? transparentLabel : '#b3dbf4'}
            aria-label={tr('bots.new.pictureColorCustom', 'Custom color')}
            maxLength={16}
            style={{ height: 28, fontSize: 12, lineHeight: '18px', width: 96, padding: '2px 8px', fontFamily: 'var(--ds-font-family-code)' }}
          />
        </div>
      </div>

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
              setPendingUpload(false);
              setLocalUpload(null);
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

/** 13 swatches × 22px + 12 × 5px gap fit one row inside 376 − 2×12px padding − 2px border. */
const AVATAR_PICKER_POPOVER_WIDTH = 376;

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
