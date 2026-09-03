import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import Alert01Icon from "@hugeicons/core-free-icons/Alert01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import AnalyticsUpIcon from "@hugeicons/core-free-icons/AnalyticsUpIcon";
import ArchiveIcon from "@hugeicons/core-free-icons/ArchiveIcon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import BarChartIcon from "@hugeicons/core-free-icons/BarChartIcon";
import BellIcon from "@hugeicons/core-free-icons/BellIcon";
import BookOpen01Icon from "@hugeicons/core-free-icons/BookOpen01Icon";
import BotIcon from "@hugeicons/core-free-icons/BotIcon";
import BoxIcon from "@hugeicons/core-free-icons/BoxIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CancelCircleIcon from "@hugeicons/core-free-icons/CancelCircleIcon";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
import ChevronLeftIcon from "@hugeicons/core-free-icons/ChevronLeftIcon";
import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
import ChevronUpIcon from "@hugeicons/core-free-icons/ChevronUpIcon";
import CircleDashedIcon from "@hugeicons/core-free-icons/CircleDashedIcon";
import CircleIcon from "@hugeicons/core-free-icons/CircleIcon";
import CircleXIcon from "@hugeicons/core-free-icons/CircleXIcon";
import Clock03Icon from "@hugeicons/core-free-icons/Clock03Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import CompassIcon from "@hugeicons/core-free-icons/CompassIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import CornerDownLeftIcon from "@hugeicons/core-free-icons/CornerDownLeftIcon";
import CursorPointer02Icon from "@hugeicons/core-free-icons/CursorPointer02Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon";
import File02Icon from "@hugeicons/core-free-icons/File02Icon";
import FileArchiveIcon from "@hugeicons/core-free-icons/FileArchiveIcon";
import FileQuestionMarkIcon from "@hugeicons/core-free-icons/FileQuestionMarkIcon";
import FileStackIcon from "@hugeicons/core-free-icons/FileStackIcon";
import FlameIcon from "@hugeicons/core-free-icons/FlameIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GitForkIcon from "@hugeicons/core-free-icons/GitForkIcon";
import GlobeIcon from "@hugeicons/core-free-icons/GlobeIcon";
import Grid2X2Icon from "@hugeicons/core-free-icons/Grid2X2Icon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import InboxIcon from "@hugeicons/core-free-icons/InboxIcon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import LibraryIcon from "@hugeicons/core-free-icons/LibraryIcon";
import ListViewIcon from "@hugeicons/core-free-icons/ListViewIcon";
import Loading02Icon from "@hugeicons/core-free-icons/Loading02Icon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import LockKeyIcon from "@hugeicons/core-free-icons/LockKeyIcon";
import Maximize02Icon from "@hugeicons/core-free-icons/Maximize02Icon";
import Minimize02Icon from "@hugeicons/core-free-icons/Minimize02Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PencilIcon from "@hugeicons/core-free-icons/PencilIcon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon";
import PlugSocketIcon from "@hugeicons/core-free-icons/PlugSocketIcon";
import PowerIcon from "@hugeicons/core-free-icons/PowerIcon";
import PowerOffIcon from "@hugeicons/core-free-icons/PowerOffIcon";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import RotateLeft01Icon from "@hugeicons/core-free-icons/RotateLeft01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import SecurityCheckIcon from "@hugeicons/core-free-icons/SecurityCheckIcon";
import SecurityWarningIcon from "@hugeicons/core-free-icons/SecurityWarningIcon";
import SentIcon from "@hugeicons/core-free-icons/SentIcon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import Target01Icon from "@hugeicons/core-free-icons/Target01Icon";
import Undo02Icon from "@hugeicons/core-free-icons/Undo02Icon";
import Upload01Icon from "@hugeicons/core-free-icons/Upload01Icon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { HugeiconsIconProps, IconSvgElement } from "@hugeicons/react";
import type { ComponentType, Ref } from "react";

type IconProps = Omit<HugeiconsIconProps, "altIcon" | "icon"> & {
  ref?: Ref<SVGSVGElement>;
};

export type AppIcon = ComponentType<IconProps>;

export function createHugeicon(icon: IconSvgElement, displayName: string): AppIcon {
  function AppHugeicon({ color = "currentColor", ref, strokeWidth = 1.5, ...props }: IconProps) {
    return (
      <HugeiconsIcon ref={ref} icon={icon} color={color} strokeWidth={strokeWidth} {...props} />
    );
  }

  AppHugeicon.displayName = displayName;

  return AppHugeicon;
}

export const AlertCircle = /* @__PURE__ */ createHugeicon(AlertCircleIcon, "AlertCircle");
export const AlertTriangle = /* @__PURE__ */ createHugeicon(Alert01Icon, "AlertTriangle");
export const Archive = /* @__PURE__ */ createHugeicon(ArchiveIcon, "Archive");
export const ArrowLeft = /* @__PURE__ */ createHugeicon(ArrowLeft01Icon, "ArrowLeft");
export const ArrowRight = /* @__PURE__ */ createHugeicon(ArrowRight01Icon, "ArrowRight");
export const ArrowUp = /* @__PURE__ */ createHugeicon(ArrowUp01Icon, "ArrowUp");
export const ArrowUpRight = /* @__PURE__ */ createHugeicon(ArrowUpRight01Icon, "ArrowUpRight");
export const BarChart3 = /* @__PURE__ */ createHugeicon(BarChartIcon, "BarChart3");
export const Bell = /* @__PURE__ */ createHugeicon(BellIcon, "Bell");
export const BookOpen = /* @__PURE__ */ createHugeicon(BookOpen01Icon, "BookOpen");
export const Bot = /* @__PURE__ */ createHugeicon(BotIcon, "Bot");
export const Box = /* @__PURE__ */ createHugeicon(BoxIcon, "Box");
export const Check = /* @__PURE__ */ createHugeicon(CheckIcon, "Check");
export const CheckCircle2 = /* @__PURE__ */ createHugeicon(CheckmarkCircle02Icon, "CheckCircle2");
export const ChevronDown = /* @__PURE__ */ createHugeicon(ChevronDownIcon, "ChevronDown");
export const ChevronLeft = /* @__PURE__ */ createHugeicon(ChevronLeftIcon, "ChevronLeft");
export const ChevronRight = /* @__PURE__ */ createHugeicon(ChevronRightIcon, "ChevronRight");
export const ChevronUp = /* @__PURE__ */ createHugeicon(ChevronUpIcon, "ChevronUp");
export const Circle = /* @__PURE__ */ createHugeicon(CircleIcon, "Circle");
export const CircleDashed = /* @__PURE__ */ createHugeicon(CircleDashedIcon, "CircleDashed");
export const CircleX = /* @__PURE__ */ createHugeicon(CircleXIcon, "CircleX");
export const Clock3 = /* @__PURE__ */ createHugeicon(Clock03Icon, "Clock3");
export const Code = /* @__PURE__ */ createHugeicon(CodeIcon, "Code");
export const Compass = /* @__PURE__ */ createHugeicon(CompassIcon, "Compass");
export const Copy = /* @__PURE__ */ createHugeicon(Copy01Icon, "Copy");
export const CornerDownLeft = /* @__PURE__ */ createHugeicon(CornerDownLeftIcon, "CornerDownLeft");
export const Download = /* @__PURE__ */ createHugeicon(Download01Icon, "Download");
export const ExternalLink = /* @__PURE__ */ createHugeicon(ExternalLinkIcon, "ExternalLink");
export const FileArchive = /* @__PURE__ */ createHugeicon(FileArchiveIcon, "FileArchive");
export const FileQuestion = /* @__PURE__ */ createHugeicon(FileQuestionMarkIcon, "FileQuestion");
export const FileStack = /* @__PURE__ */ createHugeicon(FileStackIcon, "FileStack");
export const FileText = /* @__PURE__ */ createHugeicon(File02Icon, "FileText");
export const Flame = /* @__PURE__ */ createHugeicon(FlameIcon, "Flame");
export const GitBranch = /* @__PURE__ */ createHugeicon(GitBranchIcon, "GitBranch");
export const GitFork = /* @__PURE__ */ createHugeicon(GitForkIcon, "GitFork");
export const Globe = /* @__PURE__ */ createHugeicon(GlobeIcon, "Globe");
export const Grid2X2 = /* @__PURE__ */ createHugeicon(Grid2X2Icon, "Grid2X2");
export const HelpCircle = /* @__PURE__ */ createHugeicon(HelpCircleIcon, "HelpCircle");
export const Inbox = /* @__PURE__ */ createHugeicon(InboxIcon, "Inbox");
export const Info = /* @__PURE__ */ createHugeicon(InformationCircleIcon, "Info");
export const KeyRound = /* @__PURE__ */ createHugeicon(Key02Icon, "KeyRound");
export const Layers = /* @__PURE__ */ createHugeicon(Layers01Icon, "Layers");
export const Library = /* @__PURE__ */ createHugeicon(LibraryIcon, "Library");
export const List = /* @__PURE__ */ createHugeicon(ListViewIcon, "List");
export const Loader2 = /* @__PURE__ */ createHugeicon(Loading02Icon, "Loader2");
export const LoaderCircle = /* @__PURE__ */ createHugeicon(Loading03Icon, "LoaderCircle");
export const Lock = /* @__PURE__ */ createHugeicon(LockIcon, "Lock");
export const LockKeyhole = /* @__PURE__ */ createHugeicon(LockKeyIcon, "LockKeyhole");
export const Maximize2 = /* @__PURE__ */ createHugeicon(Maximize02Icon, "Maximize2");
export const Minimize2 = /* @__PURE__ */ createHugeicon(Minimize02Icon, "Minimize2");
export const MoreHorizontal = /* @__PURE__ */ createHugeicon(MoreHorizontalIcon, "MoreHorizontal");
export const MousePointerClick = /* @__PURE__ */ createHugeicon(
  CursorPointer02Icon,
  "MousePointerClick",
);
export const Paperclip = /* @__PURE__ */ createHugeicon(AttachmentIcon, "Paperclip");
export const Pencil = /* @__PURE__ */ createHugeicon(PencilIcon, "Pencil");
export const Pin = /* @__PURE__ */ createHugeicon(PinIcon, "Pin");
export const PinOff = /* @__PURE__ */ createHugeicon(PinOffIcon, "PinOff");
export const Plus = /* @__PURE__ */ createHugeicon(Add01Icon, "Plus");
export const Power = /* @__PURE__ */ createHugeicon(PowerIcon, "Power");
export const PowerOff = /* @__PURE__ */ createHugeicon(PowerOffIcon, "PowerOff");
export const RefreshCw = /* @__PURE__ */ createHugeicon(RefreshIcon, "RefreshCw");
export const RotateCcw = /* @__PURE__ */ createHugeicon(RotateLeft01Icon, "RotateCcw");
export const Search = /* @__PURE__ */ createHugeicon(Search01Icon, "Search");
export const Send = /* @__PURE__ */ createHugeicon(SentIcon, "Send");
export const Settings = /* @__PURE__ */ createHugeicon(Settings02Icon, "Settings");
export const ShieldAlert = /* @__PURE__ */ createHugeicon(SecurityWarningIcon, "ShieldAlert");
export const ShieldCheck = /* @__PURE__ */ createHugeicon(SecurityCheckIcon, "ShieldCheck");
export const Sparkles = /* @__PURE__ */ createHugeicon(SparklesIcon, "Sparkles");
export const SquareTerminal = /* @__PURE__ */ createHugeicon(
  ComputerTerminal01Icon,
  "SquareTerminal",
);
export const Star = /* @__PURE__ */ createHugeicon(StarIcon, "Star");
export const Target = /* @__PURE__ */ createHugeicon(Target01Icon, "Target");
export const Terminal = /* @__PURE__ */ createHugeicon(ComputerTerminal01Icon, "Terminal");
export const Trash2 = /* @__PURE__ */ createHugeicon(Delete02Icon, "Trash2");
export const TrendingUp = /* @__PURE__ */ createHugeicon(AnalyticsUpIcon, "TrendingUp");
export const TriangleAlert = /* @__PURE__ */ createHugeicon(Alert01Icon, "TriangleAlert");
export const Undo2 = /* @__PURE__ */ createHugeicon(Undo02Icon, "Undo2");
export const Unplug = /* @__PURE__ */ createHugeicon(PlugSocketIcon, "Unplug");
export const Upload = /* @__PURE__ */ createHugeicon(Upload01Icon, "Upload");
export const User = /* @__PURE__ */ createHugeicon(UserIcon, "User");
export const X = /* @__PURE__ */ createHugeicon(Cancel01Icon, "X");
export const XCircle = /* @__PURE__ */ createHugeicon(CancelCircleIcon, "XCircle");
export const XIcon = X;
export const Zap = /* @__PURE__ */ createHugeicon(ZapIcon, "Zap");
