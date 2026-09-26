import LithoInterface from "./ui/LithoInterface";
import { I18nProvider, useI18n, languages, dictionaries } from "./i18n";
import type { Lang } from "./i18n";

function Header() {
    const { t, lang, setLang } = useI18n();
    return <div className={"rows header dark-bg px-2 py-1 d-flex align-items-center border-bottom border-secondary"}>
        <strong className={"me-2"}>{t.appTitle}</strong>
        <span className={"small text-muted"}>{t.appSubtitle}</span>
        <select className={"form-select form-select-sm ms-auto"} style={{ width: "auto" }} value={lang}
            aria-label={t.language} title={t.language} onChange={e => setLang(e.target.value as Lang)}>
            {languages.map(l => <option key={l} value={l}>{dictionaries[l].langName}</option>)}
        </select>
        <a className={"ms-3 small"} href={"https://github.com/ROMERUU-dev/litomask"} target={"_blank"} rel={"noreferrer"}>GitHub</a>
    </div>;
}

export default function App() {
    return (
        <I18nProvider>
            <div className={"pagefill box"}>
                <Header />
                <div className={"rows content"}>
                    <LithoInterface />
                </div>
            </div>
        </I18nProvider>
    );
}
