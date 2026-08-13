import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type GulfDialect = 'Gulf' | 'Saudi' | 'Kuwaiti' | 'Emirati' | 'Bahraini' | 'Qatari' | 'Omani' | 'Egyptian' | 'Yemeni';

const DIALECT_OPTIONS: { value: GulfDialect; label: string; flag: string }[] = [
  { value: 'Gulf', label: 'Gulf Arabic (General)', flag: '🌊' },
  { value: 'Saudi', label: 'Saudi Arabia', flag: '🇸🇦' },
  { value: 'Kuwaiti', label: 'Kuwait', flag: '🇰🇼' },
  { value: 'Emirati', label: 'UAE', flag: '🇦🇪' },
  { value: 'Bahraini', label: 'Bahrain', flag: '🇧🇭' },
  { value: 'Qatari', label: 'Qatar', flag: '🇶🇦' },
  { value: 'Omani', label: 'Oman', flag: '🇴🇲' },
  { value: 'Egyptian', label: 'Egyptian Arabic', flag: '🇪🇬' },
  { value: 'Yemeni', label: 'Yemeni Arabic', flag: '🇾🇪' },
];

interface DialectSelectorProps {
  value: GulfDialect;
  onChange: (dialect: GulfDialect) => void;
  className?: string;
}

export const DialectSelector = ({ value, onChange, className }: DialectSelectorProps) => {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as GulfDialect)}>
      <SelectTrigger className={className ?? 'w-[200px]'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DIALECT_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex items-center gap-2">
              <span>{opt.flag}</span>
              <span>{opt.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export { DIALECT_OPTIONS };
