import { ChevronLeft, ChevronRight } from "lucide-react";
import { ModelType } from "./types";

interface ModelDetailsProps {
    currentModel: ModelType;
    prevModel: () => void;
    nextModel: () => void;
    isFirstModel: boolean;
    isLastModel: boolean;
}

export function ModelDetails({ currentModel, prevModel, nextModel, isFirstModel, isLastModel }: ModelDetailsProps) {
    return (
        <div className="m-auto flex gap-4 justify-center w-full px-4 items-center">

        </div>
    );
}

