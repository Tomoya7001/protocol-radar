/**
 * Central icon module. Icons are SVG ONLY (lucide-react) per 02_DESIGN.md §A.8 — never
 * emoji. Every icon is re-exported with a semantic name so components reference roles, and
 * a design-conformance test can assert all icons flow through here.
 */
export {
  CheckCircle2 as IconFresh,
  AlertTriangle as IconWarn,
  XCircle as IconVanished,
  Clock as IconPending,
  HelpCircle as IconUnknown,
  Activity as IconActive,
  CircleSlash as IconInactive,
  Copy as IconCopy,
  Check as IconCopied,
  ArrowLeft as IconBack,
  ExternalLink as IconExternal,
  Radar as IconRadar,
  ShieldCheck as IconShieldOk,
  ShieldAlert as IconShieldAlert,
  Languages as IconLanguages,
  Inbox as IconEmpty,
  GitBranch as IconVersion,
  FileText as IconSpec,
} from "lucide-react";
