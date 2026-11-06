import { LANGUAGES } from "./languages.ts";

interface LanguageSelectProps {
    value: string;
    onChange: (language: string) => void;
    onFocus?: () => void;
}

/** 手寫的圍欄可能是清單裡沒有的語言，要多一項才看得到目前的值。 */
function LanguageSelect({ value, onChange, onFocus }: LanguageSelectProps) {
    const known = LANGUAGES.some(({ id }) => id === value);
    return (
        <select
            aria-label="程式語言"
            value={value}
            onFocus={onFocus}
            onChange={(evt) => onChange(evt.target.value)}
        >
            {!known && <option value={value}>{value}</option>}
            {LANGUAGES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
    );
}

export default LanguageSelect;
