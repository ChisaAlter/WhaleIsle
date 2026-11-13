/**
 * Shared current-color product icons. Names identify the glyph and weight;
 * rendered size remains a prop instead of part of the component name. Each
 * icon references its `dsw-icon-<glyph>-<weight>` symbol in the document icon
 * sprite that ui-theme maintains, so a theme can replace the artwork without
 * touching callers and the artwork inherits `currentColor` and CSS variables.
 */
import { ICON_ARTWORK, iconSymbolId, type IconGlyph, type IconWeight } from './artwork.ts'
import type { IconProps } from './props.ts'

export type { IconProps } from './props.ts'
export { ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE, ICON_SYMBOLS, type IconSymbolId } from './artwork.ts'

/** Shared shield contour used by composite icons outside this module. */
export const SHIELD_OUTLINE_PATH = 'M6.80132 2.14853C7.70663 1.80917 8.70422 1.80919 9.60952 2.14859L14.1296 3.84317V7.11961C14.1296 11.6089 10.7615 13.5975 8.20543 14.5779C5.64931 13.5975 2.28052 11.6089 2.28052 7.11961V3.84317L6.80132 2.14853Z'

function productIcon(glyph: IconGlyph, weight: IconWeight): (props: IconProps) => React.JSX.Element {
  const { size: defaultSize, aspect: [width, height] = [1, 1] }: { size: number; aspect?: readonly [number, number] } = ICON_ARTWORK[glyph]
  const id = iconSymbolId(glyph, weight)
  return ({ size = defaultSize, className }: IconProps) => (
    <svg width={(size * width) / height} height={size} className={className} data-icon={id} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  )
}

/** Regular one-pixel IconLayersOutline artwork. */
export const IconLayersOutlineRegular = productIcon('layers-outline', 'regular')

/** Medium IconLayersOutline artwork with a 1.3px stroke. */
export const IconLayersOutlineMedium = productIcon('layers-outline', 'medium')

/** Regular one-pixel IconNewChatOutline artwork. */
export const IconNewChatOutlineRegular = productIcon('new-chat-outline', 'regular')

/** Medium IconNewChatOutline artwork with a 1.3px stroke. */
export const IconNewChatOutlineMedium = productIcon('new-chat-outline', 'medium')

/** Regular one-pixel IconSearchOutline artwork. */
export const IconSearchOutlineRegular = productIcon('search-outline', 'regular')

/** Medium IconSearchOutline artwork with a 1.3px stroke. */
export const IconSearchOutlineMedium = productIcon('search-outline', 'medium')

/** Regular one-pixel IconEyeOutline artwork. */
export const IconEyeOutlineRegular = productIcon('eye-outline', 'regular')

/** Medium IconEyeOutline artwork with a 1.3px stroke. */
export const IconEyeOutlineMedium = productIcon('eye-outline', 'medium')

/** Regular one-pixel IconEyeOffOutline artwork. */
export const IconEyeOffOutlineRegular = productIcon('eye-off-outline', 'regular')

/** Medium IconEyeOffOutline artwork with a 1.3px stroke. */
export const IconEyeOffOutlineMedium = productIcon('eye-off-outline', 'medium')

/** Regular one-pixel IconGlobeOutline artwork. */
export const IconGlobeOutlineRegular = productIcon('globe-outline', 'regular')

/** Medium IconGlobeOutline artwork with a 1.3px stroke. */
export const IconGlobeOutlineMedium = productIcon('globe-outline', 'medium')

/** Regular one-pixel IconSettingsOutline artwork. */
export const IconSettingsOutlineRegular = productIcon('settings-outline', 'regular')

/** Medium IconSettingsOutline artwork with a 1.3px stroke. */
export const IconSettingsOutlineMedium = productIcon('settings-outline', 'medium')

/** Regular one-pixel IconPanelLeftOutline artwork. */
export const IconPanelLeftOutlineRegular = productIcon('panel-left-outline', 'regular')

/** Medium IconPanelLeftOutline artwork with a 1.3px stroke. */
export const IconPanelLeftOutlineMedium = productIcon('panel-left-outline', 'medium')

/** Regular IconEllipsisOutline artwork; its fill-only geometry is weight-independent. */
export const IconEllipsisOutlineRegular = productIcon('ellipsis-outline', 'regular')

/** Medium IconEllipsisOutline artwork; it matches Regular because the geometry is fill-only. */
export const IconEllipsisOutlineMedium = productIcon('ellipsis-outline', 'medium')

/** Regular one-pixel IconPlusOutline artwork. */
export const IconPlusOutlineRegular = productIcon('plus-outline', 'regular')

/** Medium IconPlusOutline artwork with a 1.3px stroke. */
export const IconPlusOutlineMedium = productIcon('plus-outline', 'medium')

/** Regular one-pixel IconCheckOutline artwork. */
export const IconCheckOutlineRegular = productIcon('check-outline', 'regular')

/** Medium IconCheckOutline artwork with a 1.3px stroke. */
export const IconCheckOutlineMedium = productIcon('check-outline', 'medium')

/** Regular one-pixel IconBranchOutline artwork. */
export const IconBranchOutlineRegular = productIcon('branch-outline', 'regular')

/** Medium IconBranchOutline artwork with a 1.3px stroke. */
export const IconBranchOutlineMedium = productIcon('branch-outline', 'medium')

/** Regular one-pixel IconChevronDownOutline artwork. */
export const IconChevronDownOutlineRegular = productIcon('chevron-down-outline', 'regular')

/** Medium IconChevronDownOutline artwork with a 1.3px stroke. */
export const IconChevronDownOutlineMedium = productIcon('chevron-down-outline', 'medium')

/** Regular one-pixel IconChevronLeftOutline artwork. */
export const IconChevronLeftOutlineRegular = productIcon('chevron-left-outline', 'regular')

/** Medium IconChevronLeftOutline artwork with a 1.3px stroke. */
export const IconChevronLeftOutlineMedium = productIcon('chevron-left-outline', 'medium')

/** Regular one-pixel IconChevronRightOutline artwork. */
export const IconChevronRightOutlineRegular = productIcon('chevron-right-outline', 'regular')

/** Medium IconChevronRightOutline artwork with a 1.3px stroke. */
export const IconChevronRightOutlineMedium = productIcon('chevron-right-outline', 'medium')

/** Regular IconTriangleRightFill artwork; its fill-only geometry is weight-independent. */
export const IconTriangleRightFillRegular = productIcon('triangle-right-fill', 'regular')

/** Medium IconTriangleRightFill artwork; it matches Regular because the geometry is fill-only. */
export const IconTriangleRightFillMedium = productIcon('triangle-right-fill', 'medium')

/** Regular one-pixel IconChevronUpOutline artwork. */
export const IconChevronUpOutlineRegular = productIcon('chevron-up-outline', 'regular')

/** Medium IconChevronUpOutline artwork with a 1.3px stroke. */
export const IconChevronUpOutlineMedium = productIcon('chevron-up-outline', 'medium')

/** Regular one-pixel IconCloseOutline artwork. */
export const IconCloseOutlineRegular = productIcon('close-outline', 'regular')

/** Medium IconCloseOutline artwork with a 1.3px stroke. */
export const IconCloseOutlineMedium = productIcon('close-outline', 'medium')

/** Regular one-pixel IconCloseFill artwork. */
export const IconCloseFillRegular = productIcon('close-fill', 'regular')

/** Medium IconCloseFill artwork with a 1.3px stroke. */
export const IconCloseFillMedium = productIcon('close-fill', 'medium')

/** Regular IconCloseCircleFill artwork (cross knocked out of a filled disc); its fill-only geometry is weight-independent. */
export const IconCloseCircleFillRegular = productIcon('close-circle-fill', 'regular')

/** Medium IconCloseCircleFill artwork; it matches Regular because the geometry is fill-only. */
export const IconCloseCircleFillMedium = productIcon('close-circle-fill', 'medium')

/** Regular one-pixel IconCopyOutline artwork. */
export const IconCopyOutlineRegular = productIcon('copy-outline', 'regular')

/** Medium IconCopyOutline artwork with a 1.3px stroke. */
export const IconCopyOutlineMedium = productIcon('copy-outline', 'medium')

/** Regular one-pixel IconRefreshOutline artwork. */
export const IconRefreshOutlineRegular = productIcon('refresh-outline', 'regular')

/** Medium IconRefreshOutline artwork with a 1.3px stroke. */
export const IconRefreshOutlineMedium = productIcon('refresh-outline', 'medium')

/** Regular one-pixel IconLikeOutline artwork. */
export const IconLikeOutlineRegular = productIcon('like-outline', 'regular')

/** Medium IconLikeOutline artwork with a 1.3px stroke. */
export const IconLikeOutlineMedium = productIcon('like-outline', 'medium')

/** Regular one-pixel IconLikeFill artwork. */
export const IconLikeFillRegular = productIcon('like-fill', 'regular')

/** Medium IconLikeFill artwork with a 1.3px stroke. */
export const IconLikeFillMedium = productIcon('like-fill', 'medium')

/** Regular one-pixel IconDislikeOutline artwork. */
export const IconDislikeOutlineRegular = productIcon('dislike-outline', 'regular')

/** Medium IconDislikeOutline artwork with a 1.3px stroke. */
export const IconDislikeOutlineMedium = productIcon('dislike-outline', 'medium')

/** Regular one-pixel IconDislikeFill artwork. */
export const IconDislikeFillRegular = productIcon('dislike-fill', 'regular')

/** Medium IconDislikeFill artwork with a 1.3px stroke. */
export const IconDislikeFillMedium = productIcon('dislike-fill', 'medium')

/** Regular one-pixel IconShareOutline artwork. */
export const IconShareOutlineRegular = productIcon('share-outline', 'regular')

/** Medium IconShareOutline artwork with a 1.3px stroke. */
export const IconShareOutlineMedium = productIcon('share-outline', 'medium')

/** Regular one-pixel IconDeliverDoc artwork. */
export const IconDeliverDocRegular = productIcon('deliver-doc', 'regular')

/** Medium IconDeliverDoc artwork with a 1.3px stroke. */
export const IconDeliverDocMedium = productIcon('deliver-doc', 'medium')

/** Regular one-pixel IconEditOutline artwork. */
export const IconEditOutlineRegular = productIcon('edit-outline', 'regular')

/** Medium IconEditOutline artwork with a 1.3px stroke. */
export const IconEditOutlineMedium = productIcon('edit-outline', 'medium')

/** Regular one-pixel IconThinkOutline artwork. */
export const IconThinkOutlineRegular = productIcon('think-outline', 'regular')

/** Medium IconThinkOutline artwork with a 1.3px stroke. */
export const IconThinkOutlineMedium = productIcon('think-outline', 'medium')

/** Regular one-pixel IconAgentPresetOutline artwork. */
export const IconAgentPresetOutlineRegular = productIcon('agent-preset-outline', 'regular')

/** Medium IconAgentPresetOutline artwork with a 1.3px stroke. */
export const IconAgentPresetOutlineMedium = productIcon('agent-preset-outline', 'medium')

/** Regular one-pixel IconBrowseOutline artwork. */
export const IconBrowseOutlineRegular = productIcon('browse-outline', 'regular')

/** Medium IconBrowseOutline artwork with a 1.3px stroke. */
export const IconBrowseOutlineMedium = productIcon('browse-outline', 'medium')

/** Regular one-pixel IconContextInjectionOutline artwork. */
export const IconContextInjectionOutlineRegular = productIcon('context-injection-outline', 'regular')

/** Medium IconContextInjectionOutline artwork with a 1.3px stroke. */
export const IconContextInjectionOutlineMedium = productIcon('context-injection-outline', 'medium')

/** Regular one-pixel IconLinkOutline artwork. */
export const IconLinkOutlineRegular = productIcon('link-outline', 'regular')

/** Medium IconLinkOutline artwork with a 1.3px stroke. */
export const IconLinkOutlineMedium = productIcon('link-outline', 'medium')

/** Regular one-pixel IconRightUpOutline artwork. */
export const IconRightUpOutlineRegular = productIcon('right-up-outline', 'regular')

/** Medium IconRightUpOutline artwork with a 1.3px stroke. */
export const IconRightUpOutlineMedium = productIcon('right-up-outline', 'medium')

/** Regular one-pixel IconEnhanceOutline artwork. */
export const IconEnhanceOutlineRegular = productIcon('enhance-outline', 'regular')

/** Medium IconEnhanceOutline artwork with a 1.3px stroke. */
export const IconEnhanceOutlineMedium = productIcon('enhance-outline', 'medium')

/** Regular one-pixel IconTrashOutline artwork. */
export const IconTrashOutlineRegular = productIcon('trash-outline', 'regular')

/** Medium IconTrashOutline artwork with a 1.3px stroke. */
export const IconTrashOutlineMedium = productIcon('trash-outline', 'medium')

/** Regular one-pixel IconWarningOutline artwork. */
export const IconWarningOutlineRegular = productIcon('warning-outline', 'regular')

/** Medium IconWarningOutline artwork with a 1.3px stroke. */
export const IconWarningOutlineMedium = productIcon('warning-outline', 'medium')

/** Regular IconCheckCircleFill artwork (circled check); its fill-only geometry is weight-independent. */
export const IconCheckCircleFillRegular = productIcon('check-circle-fill', 'regular')

/** Medium IconCheckCircleFill artwork; it matches Regular because the geometry is fill-only. */
export const IconCheckCircleFillMedium = productIcon('check-circle-fill', 'medium')

/** Regular rounded warning triangle with an exclamation mark. */
export const IconWarningTriangleOutlineRegular = productIcon('warning-triangle-outline', 'regular')

/** Medium rounded warning triangle with an exclamation mark. */
export const IconWarningTriangleOutlineMedium = productIcon('warning-triangle-outline', 'medium')

/** Regular one-pixel IconUserOutline artwork. */
export const IconUserOutlineRegular = productIcon('user-outline', 'regular')

/** Medium IconUserOutline artwork with a 1.3px stroke. */
export const IconUserOutlineMedium = productIcon('user-outline', 'medium')

/** Regular one-pixel IconUsersOutline artwork: a front person with a second person behind. */
export const IconUsersOutlineRegular = productIcon('users-outline', 'regular')

/** Medium IconUsersOutline artwork with a 1.3px stroke. */
export const IconUsersOutlineMedium = productIcon('users-outline', 'medium')

/** Regular one-pixel IconPaperPlaneOutline artwork. */
export const IconPaperPlaneOutlineRegular = productIcon('paper-plane-outline', 'regular')

/** Medium IconPaperPlaneOutline artwork with a 1.3px stroke. */
export const IconPaperPlaneOutlineMedium = productIcon('paper-plane-outline', 'medium')

/** Regular IconStopFill artwork; its fill-only geometry is weight-independent. */
export const IconStopFillRegular = productIcon('stop-fill', 'regular')

/** Medium IconStopFill artwork; it matches Regular because the geometry is fill-only. */
export const IconStopFillMedium = productIcon('stop-fill', 'medium')

/** Regular one-pixel IconPaperclipOutline artwork. */
export const IconPaperclipOutlineRegular = productIcon('paperclip-outline', 'regular')

/** Medium IconPaperclipOutline artwork with a 1.3px stroke. */
export const IconPaperclipOutlineMedium = productIcon('paperclip-outline', 'medium')

/** Regular one-pixel IconLoadingOutline artwork. */
export const IconLoadingOutlineRegular = productIcon('loading-outline', 'regular')

/** Medium IconLoadingOutline artwork with a 1.3px stroke. */
export const IconLoadingOutlineMedium = productIcon('loading-outline', 'medium')

/** Regular one-pixel IconDownloadOutline artwork. */
export const IconDownloadOutlineRegular = productIcon('download-outline', 'regular')

/** Medium IconDownloadOutline artwork with a 1.3px stroke. */
export const IconDownloadOutlineMedium = productIcon('download-outline', 'medium')

/** Regular one-pixel IconPlayOutline artwork. */
export const IconPlayOutlineRegular = productIcon('play-outline', 'regular')

/** Medium IconPlayOutline artwork with a 1.3px stroke. */
export const IconPlayOutlineMedium = productIcon('play-outline', 'medium')

/** Regular one-pixel IconPauseOutline artwork. */
export const IconPauseOutlineRegular = productIcon('pause-outline', 'regular')

/** Medium IconPauseOutline artwork with a 1.3px stroke. */
export const IconPauseOutlineMedium = productIcon('pause-outline', 'medium')

/** Regular one-pixel IconFullscreenOutline artwork. */
export const IconFullscreenOutlineRegular = productIcon('fullscreen-outline', 'regular')

/** Medium IconFullscreenOutline artwork with a 1.3px stroke. */
export const IconFullscreenOutlineMedium = productIcon('fullscreen-outline', 'medium')

/** Regular one-pixel IconCodeOutline artwork. */
export const IconCodeOutlineRegular = productIcon('code-outline', 'regular')

/** Medium IconCodeOutline artwork with a 1.3px stroke. */
export const IconCodeOutlineMedium = productIcon('code-outline', 'medium')

/** Regular one-pixel IconCordisPluginOutline artwork. */
export const IconCordisPluginOutlineRegular = productIcon('cordis-plugin-outline', 'regular')

/** Medium IconCordisPluginOutline artwork with a 1.3px stroke. */
export const IconCordisPluginOutlineMedium = productIcon('cordis-plugin-outline', 'medium')

/** Regular one-pixel IconApiOutline artwork. */
export const IconApiOutlineRegular = productIcon('api-outline', 'regular')

/** Medium IconApiOutline artwork with a 1.3px stroke. */
export const IconApiOutlineMedium = productIcon('api-outline', 'medium')

/** Regular one-pixel IconPersonalizationOutline artwork. */
export const IconPersonalizationOutlineRegular = productIcon('personalization-outline', 'regular')

/** Medium IconPersonalizationOutline artwork with a 1.3px stroke. */
export const IconPersonalizationOutlineMedium = productIcon('personalization-outline', 'medium')

/** Regular one-pixel IconProjectAddOutline artwork. */
export const IconProjectAddOutlineRegular = productIcon('project-add-outline', 'regular')

/** Medium IconProjectAddOutline artwork with a 1.3px stroke. */
export const IconProjectAddOutlineMedium = productIcon('project-add-outline', 'medium')

/** Regular one-pixel IconFolderOpenOutline artwork. */
export const IconFolderOpenOutlineRegular = productIcon('folder-open-outline', 'regular')

/** Medium IconFolderOpenOutline artwork with a 1.3px stroke. */
export const IconFolderOpenOutlineMedium = productIcon('folder-open-outline', 'medium')

/** Regular IconFolderOpen artwork; its fill-only geometry is weight-independent. */
export const IconFolderOpenRegular = productIcon('folder-open', 'regular')

/** Medium IconFolderOpen artwork; it matches Regular because the geometry is fill-only. */
export const IconFolderOpenMedium = productIcon('folder-open', 'medium')

/** Regular one-pixel IconFolderClose artwork. */
export const IconFolderCloseRegular = productIcon('folder-close', 'regular')

/** Medium IconFolderClose artwork with a 1.3px stroke. */
export const IconFolderCloseMedium = productIcon('folder-close', 'medium')

/** Regular one-pixel IconTreeCorner artwork. */
export const IconTreeCornerRegular = productIcon('tree-corner', 'regular')

/** Medium IconTreeCorner artwork with a 1.3px stroke. */
export const IconTreeCornerMedium = productIcon('tree-corner', 'medium')

/** Regular one-pixel IconLightOutline artwork. */
export const IconLightOutlineRegular = productIcon('light-outline', 'regular')

/** Medium IconLightOutline artwork with a 1.3px stroke. */
export const IconLightOutlineMedium = productIcon('light-outline', 'medium')

/** Regular one-pixel IconDarkOutline artwork. */
export const IconDarkOutlineRegular = productIcon('dark-outline', 'regular')

/** Medium IconDarkOutline artwork with a 1.3px stroke. */
export const IconDarkOutlineMedium = productIcon('dark-outline', 'medium')

/** Regular one-pixel IconFollowsystemOutline artwork. */
export const IconFollowsystemOutlineRegular = productIcon('followsystem-outline', 'regular')

/** Medium IconFollowsystemOutline artwork with a 1.3px stroke. */
export const IconFollowsystemOutlineMedium = productIcon('followsystem-outline', 'medium')

/** Regular one-pixel IconDataOutline artwork. */
export const IconDataOutlineRegular = productIcon('data-outline', 'regular')

/** Medium IconDataOutline artwork with a 1.3px stroke. */
export const IconDataOutlineMedium = productIcon('data-outline', 'medium')

/** Regular one-pixel IconDatabaseOutline artwork. */
export const IconDatabaseOutlineRegular = productIcon('database-outline', 'regular')

/** Medium IconDatabaseOutline artwork with a 1.3px stroke. */
export const IconDatabaseOutlineMedium = productIcon('database-outline', 'medium')

/** Regular one-pixel IconClockOutline artwork. */
export const IconClockOutlineRegular = productIcon('clock-outline', 'regular')

/** Medium IconClockOutline artwork with a 1.3px stroke. */
export const IconClockOutlineMedium = productIcon('clock-outline', 'medium')

/** Regular one-pixel IconGaugeOutline artwork. */
export const IconGaugeOutlineRegular = productIcon('gauge-outline', 'regular')

/** Medium IconGaugeOutline artwork with a 1.3px stroke. */
export const IconGaugeOutlineMedium = productIcon('gauge-outline', 'medium')

/** Regular one-pixel IconSendOutline artwork. */
export const IconSendOutlineRegular = productIcon('send-outline', 'regular')

/** Medium IconSendOutline artwork with a 1.3px stroke. */
export const IconSendOutlineMedium = productIcon('send-outline', 'medium')

/** Regular one-pixel IconQueueOutline artwork. */
export const IconQueueOutlineRegular = productIcon('queue-outline', 'regular')

/** Medium IconQueueOutline artwork with a 1.3px stroke. */
export const IconQueueOutlineMedium = productIcon('queue-outline', 'medium')

/** Regular one-pixel IconChecklistOutline artwork. */
export const IconChecklistOutlineRegular = productIcon('checklist-outline', 'regular')

/** Medium IconChecklistOutline artwork with a 1.3px stroke. */
export const IconChecklistOutlineMedium = productIcon('checklist-outline', 'medium')

/** Regular one-pixel IconListPenOutline artwork. */
export const IconListPenOutlineRegular = productIcon('list-pen-outline', 'regular')

/** Medium IconListPenOutline artwork with a 1.3px stroke. */
export const IconListPenOutlineMedium = productIcon('list-pen-outline', 'medium')

/** Regular one-pixel IconGoalOutline artwork. */
export const IconGoalOutlineRegular = productIcon('goal-outline', 'regular')

/** Medium IconGoalOutline artwork with a 1.3px stroke. */
export const IconGoalOutlineMedium = productIcon('goal-outline', 'medium')

/** Regular one-pixel IconSparkle artwork. */
export const IconSparkleRegular = productIcon('sparkle', 'regular')

/** Medium IconSparkle artwork with a 1.3px stroke. */
export const IconSparkleMedium = productIcon('sparkle', 'medium')

/** Regular one-pixel IconInspectOutline artwork. */
export const IconInspectOutlineRegular = productIcon('inspect-outline', 'regular')

/** Medium IconInspectOutline artwork with a 1.3px stroke. */
export const IconInspectOutlineMedium = productIcon('inspect-outline', 'medium')

/** Regular one-pixel IconSkillOutline artwork. */
export const IconSkillOutlineRegular = productIcon('skill-outline', 'regular')

/** Medium IconSkillOutline artwork with a 1.3px stroke. */
export const IconSkillOutlineMedium = productIcon('skill-outline', 'medium')

/** Regular one-pixel IconQuestionOutline artwork. */
export const IconQuestionOutlineRegular = productIcon('question-outline', 'regular')

/** Medium IconQuestionOutline artwork with a 1.3px stroke. */
export const IconQuestionOutlineMedium = productIcon('question-outline', 'medium')

/** Regular IconInfoOutline artwork; its fill-only geometry is weight-independent. */
export const IconInfoOutlineRegular = productIcon('info-outline', 'regular')

/** Medium IconInfoOutline artwork; its fill-only geometry is weight-independent. */
export const IconInfoOutlineMedium = productIcon('info-outline', 'medium')

/** Regular one-pixel plugin pinwheel artwork. */
export const IconPluginPinwheelOutlineRegular = productIcon('plugin-pinwheel-outline', 'regular')

/** Medium plugin pinwheel artwork with a 1.3px stroke. */
export const IconPluginPinwheelOutlineMedium = productIcon('plugin-pinwheel-outline', 'medium')

/** Regular one-pixel IconAlarmClockOutline artwork. */
export const IconAlarmClockOutlineRegular = productIcon('alarm-clock-outline', 'regular')

/** Medium IconAlarmClockOutline artwork with a 1.3px stroke. */
export const IconAlarmClockOutlineMedium = productIcon('alarm-clock-outline', 'medium')

/** Regular one-pixel IconArchiveOutline artwork. */
export const IconArchiveOutlineRegular = productIcon('archive-outline', 'regular')

/** Medium IconArchiveOutline artwork with a 1.3px stroke. */
export const IconArchiveOutlineMedium = productIcon('archive-outline', 'medium')

/** Regular one-pixel IconWrapLinesOutline artwork. */
export const IconWrapLinesOutlineRegular = productIcon('wrap-lines-outline', 'regular')

/** Medium IconWrapLinesOutline artwork with a 1.3px stroke. */
export const IconWrapLinesOutlineMedium = productIcon('wrap-lines-outline', 'medium')

/** Regular IconNowrapFill artwork; fill-only weights render identically. */
export const IconNowrapFillRegular = productIcon('nowrap-fill', 'regular')

/** Medium IconNowrapFill artwork; fill-only weights render identically. */
export const IconNowrapFillMedium = productIcon('nowrap-fill', 'medium')

/** Regular IconWrapFill artwork; fill-only weights render identically. */
export const IconWrapFillRegular = productIcon('wrap-fill', 'regular')

/** Medium IconWrapFill artwork; fill-only weights render identically. */
export const IconWrapFillMedium = productIcon('wrap-fill', 'medium')

/** Regular one-pixel IconCompareSplitOutline artwork. */
export const IconCompareSplitOutlineRegular = productIcon('compare-split-outline', 'regular')

/** Medium IconCompareSplitOutline artwork with a 1.3px stroke. */
export const IconCompareSplitOutlineMedium = productIcon('compare-split-outline', 'medium')

/** Regular one-pixel IconPlanOutline artwork. */
export const IconPlanOutlineRegular = productIcon('plan-outline', 'regular')

/** Medium IconPlanOutline artwork with a 1.3px stroke. */
export const IconPlanOutlineMedium = productIcon('plan-outline', 'medium')

/** Regular one-pixel IconCompactOutline artwork. */
export const IconCompactOutlineRegular = productIcon('compact-outline', 'regular')

/** Medium IconCompactOutline artwork with a 1.3px stroke. */
export const IconCompactOutlineMedium = productIcon('compact-outline', 'medium')

/** Regular one-pixel IconShieldOutline artwork. */
export const IconShieldOutlineRegular = productIcon('shield-outline', 'regular')

/** Medium IconShieldOutline artwork with a 1.3px stroke. */
export const IconShieldOutlineMedium = productIcon('shield-outline', 'medium')

/** Regular one-pixel IconCheckCircleOutline artwork. */
export const IconCheckCircleOutlineRegular = productIcon('check-circle-outline', 'regular')

/** Medium IconCheckCircleOutline artwork with a 1.3px stroke. */
export const IconCheckCircleOutlineMedium = productIcon('check-circle-outline', 'medium')

/** Regular one-pixel IconUnarchiveOutline artwork. */
export const IconUnarchiveOutlineRegular = productIcon('unarchive-outline', 'regular')

/** Medium IconUnarchiveOutline artwork with a 1.3px stroke. */
export const IconUnarchiveOutlineMedium = productIcon('unarchive-outline', 'medium')

/** Regular one-pixel IconPinOutline artwork. */
export const IconPinOutlineRegular = productIcon('pin-outline', 'regular')

/** Medium IconPinOutline artwork with a 1.3px stroke. */
export const IconPinOutlineMedium = productIcon('pin-outline', 'medium')

/** Regular one-pixel IconPinFill artwork. */
export const IconPinFillRegular = productIcon('pin-fill', 'regular')

/** Medium IconPinFill artwork with a 1.3px stroke. */
export const IconPinFillMedium = productIcon('pin-fill', 'medium')

/** Regular one-pixel IconFlatListOutline artwork. */
export const IconFlatListOutlineRegular = productIcon('flat-list-outline', 'regular')

/** Medium IconFlatListOutline artwork with a 1.3px stroke. */
export const IconFlatListOutlineMedium = productIcon('flat-list-outline', 'medium')

/** Regular one-pixel IconWorkspaceTreeOutline artwork. */
export const IconWorkspaceTreeOutlineRegular = productIcon('workspace-tree-outline', 'regular')

/** Medium IconWorkspaceTreeOutline artwork with a 1.3px stroke. */
export const IconWorkspaceTreeOutlineMedium = productIcon('workspace-tree-outline', 'medium')

/** Regular one-pixel IconChevronsUpDownOutline artwork. */
export const IconChevronsUpDownOutlineRegular = productIcon('chevrons-up-down-outline', 'regular')

/** Medium IconChevronsUpDownOutline artwork with a 1.3px stroke. */
export const IconChevronsUpDownOutlineMedium = productIcon('chevrons-up-down-outline', 'medium')

/** Regular one-pixel IconDragHandleOutline artwork. */
export const IconDragHandleOutlineRegular = productIcon('drag-handle-outline', 'regular')

/** Medium IconDragHandleOutline artwork with a 1.3px stroke. */
export const IconDragHandleOutlineMedium = productIcon('drag-handle-outline', 'medium')

/** Regular one-pixel IconArchiveOffOutline artwork. */
export const IconArchiveOffOutlineRegular = productIcon('archive-off-outline', 'regular')

/** Medium IconArchiveOffOutline artwork with a 1.3px stroke. */
export const IconArchiveOffOutlineMedium = productIcon('archive-off-outline', 'medium')

/** Regular one-pixel IconArchiveCheckOutline artwork. */
export const IconArchiveCheckOutlineRegular = productIcon('archive-check-outline', 'regular')

/** Medium IconArchiveCheckOutline artwork with a 1.3px stroke. */
export const IconArchiveCheckOutlineMedium = productIcon('archive-check-outline', 'medium')

/** Regular one-pixel IconSlidersTwoOutline artwork. */
export const IconSlidersTwoOutlineRegular = productIcon('sliders-two-outline', 'regular')

/** Medium IconSlidersTwoOutline artwork with a 1.3px stroke. */
export const IconSlidersTwoOutlineMedium = productIcon('sliders-two-outline', 'medium')

/** Microphone with uniform one-pixel strokes. */
export const IconMicrophoneOutlineRegular = productIcon('microphone-outline', 'regular')

/** Microphone with uniform 1.3px strokes. */
export const IconMicrophoneOutlineMedium = productIcon('microphone-outline', 'medium')

/** Desktop compatibility aliases for pre-weight icon names. */
export const IconNewChatOutline16 = (props: IconProps) => <IconNewChatOutlineRegular size={16} {...props} />
export const IconSearchOutline16 = (props: IconProps) => <IconSearchOutlineRegular size={16} {...props} />
export const IconGlobeOutline14 = (props: IconProps) => <IconGlobeOutlineRegular size={14} {...props} />
export const IconSettingsOutline14 = (props: IconProps) => <IconSettingsOutlineRegular size={14} {...props} />
export const IconSettingsOutline16 = (props: IconProps) => <IconSettingsOutlineRegular size={16} {...props} />
export const IconPanelLeftOutline16 = (props: IconProps) => <IconPanelLeftOutlineRegular size={16} {...props} />
export const IconEllipsisOutline16 = (props: IconProps) => <IconEllipsisOutlineRegular size={16} {...props} />
export const IconPlusOutline16 = (props: IconProps) => <IconPlusOutlineRegular size={16} {...props} />
export const IconCheckOutline16 = (props: IconProps) => <IconCheckOutlineRegular size={16} {...props} />
export const IconCheckOutline14 = (props: IconProps) => <IconCheckOutlineRegular size={14} {...props} />
export const IconBranchOutline16 = (props: IconProps) => <IconBranchOutlineRegular size={16} {...props} />
export const IconChevronDownOutline14 = (props: IconProps) => <IconChevronDownOutlineRegular size={14} {...props} />
export const IconChevronLeftOutline14 = (props: IconProps) => <IconChevronLeftOutlineRegular size={14} {...props} />
export const IconChevronRightOutline14 = (props: IconProps) => <IconChevronRightOutlineRegular size={14} {...props} />
export const IconTriangleRightFill14 = (props: IconProps) => <IconTriangleRightFillRegular size={14} {...props} />
export const IconChevronUpOutline14 = (props: IconProps) => <IconChevronUpOutlineRegular size={14} {...props} />
export const IconCloseOutline16 = (props: IconProps) => <IconCloseOutlineRegular size={16} {...props} />
export const IconCloseFill14 = (props: IconProps) => <IconCloseFillRegular size={14} {...props} />
export const IconCopyOutline16 = (props: IconProps) => <IconCopyOutlineRegular size={16} {...props} />
export const IconRefreshOutline16 = (props: IconProps) => <IconRefreshOutlineRegular size={16} {...props} />
export const IconRefreshOutline14 = (props: IconProps) => <IconRefreshOutlineRegular size={14} {...props} />
export const IconLikeOutline16 = (props: IconProps) => <IconLikeOutlineRegular size={16} {...props} />
export const IconLikeFill16 = (props: IconProps) => <IconLikeFillRegular size={16} {...props} />
export const IconDislikeOutline16 = (props: IconProps) => <IconDislikeOutlineRegular size={16} {...props} />
export const IconDislikeFill16 = (props: IconProps) => <IconDislikeFillRegular size={16} {...props} />
export const IconShareOutline16 = (props: IconProps) => <IconShareOutlineRegular size={16} {...props} />
export const IconEditOutline16 = (props: IconProps) => <IconEditOutlineRegular size={16} {...props} />
export const IconThinkOutline14 = (props: IconProps) => <IconThinkOutlineRegular size={14} {...props} />
export const IconThinkOutline16 = (props: IconProps) => <IconThinkOutlineRegular size={16} {...props} />
export const IconAgentPresetOutline16 = (props: IconProps) => <IconAgentPresetOutlineRegular size={16} {...props} />
export const IconBrowseOutline16 = (props: IconProps) => <IconBrowseOutlineRegular size={16} {...props} />
export const IconContextInjectionOutline16 = (props: IconProps) => <IconContextInjectionOutlineRegular size={16} {...props} />
export const IconLinkOutline14 = (props: IconProps) => <IconLinkOutlineRegular size={14} {...props} />
export const IconLinkOutline16 = (props: IconProps) => <IconLinkOutlineRegular size={16} {...props} />
export const IconRightUpOutline14 = (props: IconProps) => <IconRightUpOutlineRegular size={14} {...props} />
export const IconRightUpOutline16 = (props: IconProps) => <IconRightUpOutlineRegular size={16} {...props} />
export const IconEnhanceOutline16 = (props: IconProps) => <IconEnhanceOutlineRegular size={16} {...props} />
export const IconTrashOutline16 = (props: IconProps) => <IconTrashOutlineRegular size={16} {...props} />
export const IconWarningOutline16 = (props: IconProps) => <IconWarningOutlineRegular size={16} {...props} />
export const IconUserOutline16 = (props: IconProps) => <IconUserOutlineRegular size={16} {...props} />
export const IconPaperPlaneOutline14 = (props: IconProps) => <IconPaperPlaneOutlineRegular size={14} {...props} />
export const IconStopFill16 = (props: IconProps) => <IconStopFillRegular size={16} {...props} />
export const IconPaperclipOutline16 = (props: IconProps) => <IconPaperclipOutlineRegular size={16} {...props} />
export const IconLoadingOutline16 = (props: IconProps) => <IconLoadingOutlineRegular size={16} {...props} />
export const IconDownloadOutline16 = (props: IconProps) => <IconDownloadOutlineRegular size={16} {...props} />
export const IconPlayOutline16 = (props: IconProps) => <IconPlayOutlineRegular size={16} {...props} />
export const IconPauseOutline16 = (props: IconProps) => <IconPauseOutlineRegular size={16} {...props} />
export const IconFullscreenOutline16 = (props: IconProps) => <IconFullscreenOutlineRegular size={16} {...props} />
export const IconCodeOutline16 = (props: IconProps) => <IconCodeOutlineRegular size={16} {...props} />
export const IconCordisPluginOutline14 = (props: IconProps) => <IconCordisPluginOutlineRegular size={14} {...props} />
export const IconApiOutline14 = (props: IconProps) => <IconApiOutlineRegular size={14} {...props} />
export const IconInfoOutline16 = (props: IconProps) => <IconInfoOutlineRegular size={16} {...props} />
export const IconPersonalizationOutline16 = (props: IconProps) => <IconPersonalizationOutlineRegular size={16} {...props} />
export const IconProjectAddOutline16 = (props: IconProps) => <IconProjectAddOutlineRegular size={16} {...props} />
export const IconFolderOpenOutline16 = (props: IconProps) => <IconFolderOpenOutlineRegular size={16} {...props} />
export const IconFolderOpen16 = (props: IconProps) => <IconFolderOpenRegular size={16} {...props} />
export const IconFolderClose16 = (props: IconProps) => <IconFolderCloseRegular size={16} {...props} />
export const IconLightOutline16 = (props: IconProps) => <IconLightOutlineRegular size={16} {...props} />
export const IconDarkOutline16 = (props: IconProps) => <IconDarkOutlineRegular size={16} {...props} />
export const IconFollowsystemOutline16 = (props: IconProps) => <IconFollowsystemOutlineRegular size={16} {...props} />
export const IconDataOutline16 = (props: IconProps) => <IconDataOutlineRegular size={16} {...props} />
export const IconDatabaseOutline16 = (props: IconProps) => <IconDatabaseOutlineRegular size={16} {...props} />
export const IconClockOutline16 = (props: IconProps) => <IconClockOutlineRegular size={16} {...props} />
export const IconGaugeOutline16 = (props: IconProps) => <IconGaugeOutlineRegular size={16} {...props} />
export const IconSendOutline14 = (props: IconProps) => <IconSendOutlineRegular size={14} {...props} />
export const IconQueueOutline14 = (props: IconProps) => <IconQueueOutlineRegular size={14} {...props} />
export const IconChecklistOutline14 = (props: IconProps) => <IconChecklistOutlineRegular size={14} {...props} />
export const IconListPenOutline16 = (props: IconProps) => <IconListPenOutlineRegular size={16} {...props} />
export const IconGoalOutline16 = (props: IconProps) => <IconGoalOutlineRegular size={16} {...props} />
export const IconSparkle16 = (props: IconProps) => <IconSparkleRegular size={16} {...props} />
export const IconSkillOutline16 = (props: IconProps) => <IconSkillOutlineRegular size={16} {...props} />
export const IconQuestionOutline14 = (props: IconProps) => <IconQuestionOutlineRegular size={14} {...props} />
export const IconInfoOutline14 = (props: IconProps) => <IconInfoOutlineRegular size={14} {...props} />
export const IconAlarmClockOutline16 = (props: IconProps) => <IconAlarmClockOutlineRegular size={16} {...props} />
export const IconArchiveOutline20 = (props: IconProps) => <IconArchiveOutlineRegular size={20} {...props} />
export const IconWrapLinesOutline16 = (props: IconProps) => <IconWrapLinesOutlineRegular size={16} {...props} />
export const IconPlanOutline14 = (props: IconProps) => <IconPlanOutlineRegular size={14} {...props} />
export const IconCompactOutline16 = (props: IconProps) => <IconCompactOutlineRegular size={16} {...props} />
export const IconShieldOutline16 = (props: IconProps) => <IconShieldOutlineRegular size={16} {...props} />
export const IconPluginPinwheelOutline16 = (props: IconProps) => <IconPluginPinwheelOutlineRegular size={16} {...props} />


/** Desktop chrome and Git artwork retained across the upstream icon refresh. */
const PANEL_FRAME_PATH = 'M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z'

export const IconPanelRightOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g transform="scale(-1,1) translate(-16,0)">
      <path fillRule="evenodd" clipRule="evenodd" d={PANEL_FRAME_PATH} fill="currentColor" />
    </g>
  </svg>
)

export const IconPanelBottomOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-90 8 8)">
      <path fillRule="evenodd" clipRule="evenodd" d={PANEL_FRAME_PATH} fill="currentColor" />
    </g>
  </svg>
)

export const IconSplitOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.2 1.6h11.6A1.6 1.6 0 0 1 15.4 3.2v9.6a1.6 1.6 0 0 1-1.6 1.6H2.2A1.6 1.6 0 0 1 0.6 12.8V3.2A1.6 1.6 0 0 1 2.2 1.6Zm0 1.35A.25.25 0 0 0 1.95 3.2v9.6c0 .138.112.25.25.25H7.25V2.95H2.2Zm6.4 0v10.1h5.2a.25.25 0 0 0 .25-.25V3.2a.25.25 0 0 0-.25-.25H8.6Z"
      fill="currentColor"
    />
  </svg>
)

export const IconCommitOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7.325 1.35v3.214A3.676 3.676 0 0 0 4.35 8c0 1.64 1.077 3.03 2.975 3.436V14.65h1.35v-3.214A3.676 3.676 0 0 0 11.65 8c0-1.64-1.077-3.03-2.975-3.436V1.35H7.325ZM8 5.7A2.3 2.3 0 1 0 8 10.3 2.3 2.3 0 0 0 8 5.7Z"
      fill="currentColor"
    />
  </svg>
)

export const IconCloudUploadOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 13v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m8 17 4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const IconPullRequestOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3.2 1.2a1.8 1.8 0 0 0-.675 3.47V11.33A1.8 1.8 0 1 0 3.875 12.7V4.67A1.8 1.8 0 0 0 3.2 1.2Zm0 1.35a.45.45 0 1 1 0 .9.45.45 0 0 1 0-.9Zm0 9.9a.45.45 0 1 1 0 .9.45.45 0 0 1 0-.9ZM12.8 4.67V9.2a2.8 2.8 0 0 1-2.8 2.8H8.65v-1.35H10a1.45 1.45 0 0 0 1.45-1.45V4.67a1.8 1.8 0 1 0-1.35 0v.01A1.8 1.8 0 1 0 12.8 4.67ZM12.8 2.55a.45.45 0 1 1 0 .9.45.45 0 0 1 0-.9Z"
      fill="currentColor"
    />
  </svg>
)

export const IconChartOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.14648 0.496094C2.51498 0.496094 2.81348 0.79459 2.81348 1.16309V12.0391C2.81348 12.6734 3.32768 13.1875 3.96191 13.1875H14.8369C15.2054 13.1875 15.5039 13.486 15.5039 13.8545C15.5039 14.223 15.2054 14.5215 14.8369 14.5215H3.96191C2.59098 14.5215 1.47949 13.4101 1.47949 12.0391V1.16309C1.47949 0.79459 1.77799 0.496094 2.14648 0.496094Z" fill="currentColor" />
    <path d="M5.16309 8.31934C5.59455 8.31934 5.94434 8.66913 5.94434 9.10059V11.1621C5.94434 11.5936 5.59455 11.9434 5.16309 11.9434C4.73163 11.9434 4.38184 11.5936 4.38184 11.1621V9.10059C4.38184 8.66913 4.73163 8.31934 5.16309 8.31934ZM8.51367 5.28711C8.94513 5.28711 9.29492 5.6369 9.29492 6.06836V11.1621C9.29492 11.5936 8.94513 11.9434 8.51367 11.9434C8.08221 11.9434 7.73242 11.5936 7.73242 11.1621V6.06836C7.73242 5.6369 8.08221 5.28711 8.51367 5.28711ZM11.8643 2.25391C12.2957 2.25391 12.6455 2.6037 12.6455 3.03516V11.1621C12.6455 11.5936 12.2957 11.9434 11.8643 11.9434C11.4328 11.9434 11.083 11.5936 11.083 11.1621V3.03516C11.083 2.6037 11.4328 2.25391 11.8643 2.25391Z" fill="currentColor" />
  </svg>
)

export const IconDeviceOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.22754 0.249023C5.61331 0.249023 5.10145 0.248519 4.68457 0.293945C4.25443 0.340817 3.87899 0.440297 3.55469 0.675781C3.36524 0.813425 3.19856 0.980099 3.06055 1.16992C2.82518 1.49413 2.72553 1.8697 2.67871 2.2998C2.63333 2.71662 2.63379 3.22858 2.63379 3.84277V12.1572C2.63379 12.7714 2.63333 13.2834 2.67871 13.7002C2.72553 14.1303 2.82518 14.5059 3.06055 14.8301C3.19856 15.0199 3.36524 15.1866 3.55469 15.3242C3.87899 15.5597 4.25443 15.6592 4.68457 15.7061C5.10145 15.7515 5.61331 15.751 6.22754 15.751H9.77246C10.3867 15.751 10.8986 15.7515 11.3154 15.7061C11.7456 15.6592 12.121 15.5597 12.4453 15.3242C12.6348 15.1866 12.8014 15.0199 12.9395 14.8301C13.1748 14.5059 13.2745 14.1303 13.3213 13.7002C13.3667 13.2834 13.3662 12.7714 13.3662 12.1572V3.84277C13.3662 3.22858 13.3667 2.71662 13.3213 2.2998C13.2745 1.8697 13.1748 1.49413 12.9395 1.16992C12.8014 0.980099 12.6348 0.813425 12.4453 0.675781C12.121 0.440297 11.7456 0.340817 11.3154 0.293945C10.8986 0.248519 10.3867 0.249023 9.77246 0.249023H6.22754ZM6.22754 1.57422C5.56654 1.57422 5.13695 1.57556 4.82715 1.60938C4.5304 1.64172 4.49377 1.6954 4.33398 1.81152C4.25351 1.87004 4.18104 1.94251 4.12207 2.02344C4.00641 2.18263 3.95215 2.21998 3.91992 2.5166C3.88614 2.8263 3.959 3.18168 3.959 3.84277V12.1572C3.959 12.8183 3.88614 13.1737 3.91992 13.4834C3.95215 13.78 4.00641 13.8174 4.12207 13.9766C4.18104 14.0575 4.25351 14.13 4.33398 14.1885C4.49377 14.3046 4.5304 14.3583 4.82715 14.3906C5.13695 14.4244 5.56654 14.4258 6.22754 14.4258H9.77246C10.4335 14.4258 10.8631 14.4244 11.1729 14.3906C11.4696 14.3583 11.5062 14.3046 11.666 14.1885C11.7465 14.13 11.819 14.0575 11.8779 13.9766C11.9936 13.8174 12.0479 13.78 12.0801 13.4834C12.1139 13.1737 12.041 12.8183 12.041 12.1572V3.84277C12.041 3.18168 12.1139 2.8263 12.0801 2.5166C12.0479 2.21998 11.9936 2.18263 11.8779 2.02344C11.819 1.94251 11.7465 1.87004 11.666 1.81152C11.5062 1.6954 11.4696 1.64172 11.1729 1.60938C10.8631 1.57556 10.4335 1.57422 9.77246 1.57422H6.22754Z"
      fill="currentColor"
    />
    <path d="M6.74414 2.29297H9.25586C9.61614 2.29297 9.9082 2.58503 9.9082 2.94531C9.9082 3.30559 9.61614 3.59766 9.25586 3.59766H6.74414C6.38386 3.59766 6.0918 3.30559 6.0918 2.94531C6.0918 2.58503 6.38386 2.29297 6.74414 2.29297ZM8 11.8965C8.43145 11.8965 8.78125 12.2463 8.78125 12.6777C8.78125 13.1092 8.43145 13.459 8 13.459C7.56855 13.459 7.21875 13.1092 7.21875 12.6777C7.21875 12.2463 7.56855 11.8965 8 11.8965Z" fill="currentColor" />
  </svg>
)

export const IconServerOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.7 1.5H13.3A1.8 1.8 0 0 1 15.1 3.3V5.3A1.8 1.8 0 0 1 13.3 7.1H2.7A1.8 1.8 0 0 1 0.9 5.3V3.3A1.8 1.8 0 0 1 2.7 1.5ZM2.7 2.8A0.5 0.5 0 0 0 2.2 3.3V5.3A0.5 0.5 0 0 0 2.7 5.8H13.3A0.5 0.5 0 0 0 13.8 5.3V3.3A0.5 0.5 0 0 0 13.3 2.8H2.7Z"
      fill="currentColor"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.7 8.9H13.3A1.8 1.8 0 0 1 15.1 10.7V12.7A1.8 1.8 0 0 1 13.3 14.5H2.7A1.8 1.8 0 0 1 0.9 12.7V10.7A1.8 1.8 0 0 1 2.7 8.9ZM2.7 10.2A0.5 0.5 0 0 0 2.2 10.7V12.7A0.5 0.5 0 0 0 2.7 13.2H13.3A0.5 0.5 0 0 0 13.8 12.7V10.7A0.5 0.5 0 0 0 13.3 10.2H2.7Z"
      fill="currentColor"
    />
    <path d="M3.95 3.55A0.75 0.75 0 1 1 3.95 5.05A0.75 0.75 0 1 1 3.95 3.55ZM6.7 3.65H10.4A0.65 0.65 0 1 1 10.4 4.95H6.7A0.65 0.65 0 1 1 6.7 3.65ZM3.95 10.95A0.75 0.75 0 1 1 3.95 12.45A0.75 0.75 0 1 1 3.95 10.95ZM6.7 11.05H10.4A0.65 0.65 0 1 1 10.4 12.35H6.7A0.65 0.65 0 1 1 6.7 11.05Z" fill="currentColor" />
  </svg>
)

/** `compact` moves the tiles 0.5px inward, for glyphs drawn at card size. */
type AppsAddIconProps = IconProps & { readonly compact?: boolean | undefined }

function appsAddIcon(weight: IconWeight): (props: AppsAddIconProps) => React.JSX.Element {
  const Wide = productIcon('apps-add-outline', weight)
  const Compact = productIcon('apps-add-compact-outline', weight)
  return ({ compact = false, ...props }: AppsAddIconProps) => (compact ? <Compact {...props} /> : <Wide {...props} />)
}

/** Three entry tiles and an add mark with one-pixel strokes. */
export const IconAppsAddOutlineRegular = appsAddIcon('regular')

/** Three entry tiles and an add mark with 1.3px strokes. */
export const IconAppsAddOutlineMedium = appsAddIcon('medium')

/** Regular floppy-disk save action. */
export const IconSaveOutlineRegular = productIcon('save-outline', 'regular')

/** Medium floppy-disk save action. */
export const IconSaveOutlineMedium = productIcon('save-outline', 'medium')
