import LithoInterface from "./ui/LithoInterface";

export default function App() {
    return (
        <div className={"pagefill box"}>
            <div className={"rows header dark-bg px-2 py-1 d-flex align-items-center border-bottom border-secondary"}>
                <strong className={"me-2"}>LitoMask</strong>
                <span className={"small text-muted"}>máscaras de fotolitografía para impresoras MSLA</span>
                <a className={"ms-auto small"} href={"https://github.com/ROMERUU-dev/litomask"} target={"_blank"} rel={"noreferrer"}>GitHub</a>
            </div>
            <div className={"rows content"}>
                <LithoInterface />
            </div>
        </div>
    );
}
