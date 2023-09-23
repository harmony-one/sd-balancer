import { IOperation, OPERATION_TYPE } from "./app.service";

export const getOperationsWeight = (operations: IOperation[]) => {
    let weight = 0;

    operations.forEach(op => {
        switch (op.type) {
            case OPERATION_TYPE.TEXT_TO_IMAGE:
                weight += 1;
                break;

            case OPERATION_TYPE.TEXT_TO_IMAGES:
                weight += 4;
                break;

            case OPERATION_TYPE.IMAGE_TO_IMAGE:
                weight += 2;
                break;

            case OPERATION_TYPE.TRAIN:
                weight += 0;
                break;
        }
    });

    const hasTrains = !!operations.filter(op => op.type === OPERATION_TYPE.TRAIN).length;

    if(hasTrains) {
        weight += 10;
    }

    return weight;
}