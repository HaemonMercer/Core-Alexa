import { useEffect, useState } from "react";
import * as api from "../../api.ts";
import type { OfficeDocuments } from "../../types.ts";

/** Office Library 的內容。`revision` 在內容增減時遞增，就會重新讀取。 */
export function useOfficeDocuments(revision: number, onError: (error: unknown) => void): OfficeDocuments | null {
    const [documents, setDocuments] = useState<OfficeDocuments | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.getOfficeDocuments()
            .then((next) => {
                if (!cancelled) setDocuments(next);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [revision, onError]);

    return documents;
}
