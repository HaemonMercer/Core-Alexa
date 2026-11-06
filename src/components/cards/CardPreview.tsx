import { useEffect, useRef } from "react";
import { renderBlocks } from "../../markdown/dom.ts";
import { parseMarkdown } from "../../markdown/parse.ts";

function CardPreview({ markdown }: { markdown: string }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        ref.current?.replaceChildren(...renderBlocks(parseMarkdown(markdown)));
    }, [markdown]);

    return <div ref={ref} className="card-preview" />;
}

export default CardPreview;
