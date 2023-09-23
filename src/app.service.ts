import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { HttpService } from '@nestjs/axios';
import { getOperationsWeight } from './helpers';

export enum OPERATION_STATUS {
    WAITING = 'WAITING',
    IN_PROGRESS = 'IN_PROGRESS',
    SUCCESS = 'SUCCESS',
    ERROR = 'ERROR',
    CANCELED_BY_CLIENT = 'CANCELED_BY_CLIENT',
    CANCELED_BY_BALANCER = 'CANCELED_BY_BALANCER',
}

export enum OPERATION_TYPE {
    TEXT_TO_IMAGE = 'image',
    IMAGE_TO_IMAGE = 'img2img',
    TEXT_TO_IMAGES = 'images',
    TRAIN = 'train'
}

const MAX_EXECUTION_TIME: Record<OPERATION_TYPE, number> = {
    [OPERATION_TYPE.TEXT_TO_IMAGE]: 120,
    [OPERATION_TYPE.IMAGE_TO_IMAGE]: 120,
    [OPERATION_TYPE.TEXT_TO_IMAGES]: 120,
    [OPERATION_TYPE.TRAIN]: 1200,
}

export interface IOperationReq {
    type: OPERATION_TYPE;
    model?: string;
    lora?: string;
    controlnet?: string;
}

export interface IOperation extends IOperationReq {
    id: string;
    status: OPERATION_STATUS;
    serverId: string;
    startTime?: number;
    endTime?: number;
}

export interface IServerReq {
    models: string[];
    loras: string[];
    controlnets: string[];
    comfyAPI: string;
    trainAPI: string;
}

export enum SERVER_STATUS {
    ONLINE = 'ONLINE',
    OFFLINE = 'OFFLINE',
}

export interface IServer extends IServerReq {
    id: string;
    url: string;
    status: SERVER_STATUS;
}

@Injectable()
export class AppService {
    private readonly logger = new Logger(AppService.name);

    servers: IServer[] = [];
    operations: IOperation[] = [];

    constructor(
        private configService: ConfigService,
        private readonly httpService: HttpService
    ) {
        this.checkServers();

        setInterval(() => this.checkServers(), 10000);

        this.operationsLoop();
    }

    checkServers = async () => {
        const servers = JSON.parse(this.configService.get('SERVERS'));

        for (let i = 0; i < servers.length; i++) {
            const serverUrl = servers[i];

            const connectedServer = this.servers.find(s => s.url === serverUrl);

            try {
                const res = await this.httpService.axiosRef.get<IServerReq>(`${serverUrl}/system_stats`);

                if (connectedServer) {
                    connectedServer.status = SERVER_STATUS.ONLINE;
                } else {
                    this.servers.push({
                        id: uuidv4(),
                        url: serverUrl,
                        models: res.data.models || [],
                        loras: res.data.loras || [],
                        controlnets: res.data.controlnets || [],
                        comfyAPI: res.data.comfyAPI,
                        trainAPI: res.data.trainAPI,
                        status: SERVER_STATUS.ONLINE
                    })
                }
            } catch (e) {
                this.logger.error('initServers', e);

                if (connectedServer) {
                    connectedServer.status = SERVER_STATUS.OFFLINE;

                    // transfer operations to other servers
                    try {
                        this.operations.filter(
                            op => op.serverId === connectedServer.id
                        ).forEach(
                            op => {
                                const newServer = this.selectOptimalServer(op);
                                op.serverId = newServer.id || op.serverId;
                            }
                        )
                    } catch {
                        this.logger.error('transfer operations to other servers', e);
                    }
                }
            }
        }
    };

    selectOptimalServer = (operation: IOperationReq) => {
        const servers = this.servers.filter(
            s => s.models.includes(operation.model) &&
                (!operation.lora || s.loras.includes(operation.lora)) &&
                (!operation.controlnet || s.controlnets.includes(operation.controlnet)) &&
                (operation.type !== OPERATION_TYPE.TRAIN || !!s.trainAPI) &&
                s.status === SERVER_STATUS.ONLINE
        );

        const weights = servers.map(
            s => getOperationsWeight(this.operations.filter(op => op.serverId === s.id))
        );

        const server = servers[
            weights.indexOf(Math.min(...weights))
        ];

        return server;
    }

    addOperation = async (operation: IOperationReq) => {
        let server = this.selectOptimalServer(operation);

        if (!server) {
            await this.checkServers();
            server = this.selectOptimalServer(operation);
        }

        if (!server) {
            throw new Error('Not founded server for this operation');
        }

        const newOperation: IOperation = {
            id: uuidv4(),
            type: operation.type,
            status: OPERATION_STATUS.WAITING,
            model: operation.model,
            lora: operation.lora,
            controlnet: operation.controlnet,
            serverId: server.id
        };

        this.operations.push(newOperation);

        return this.getFullOperationById(newOperation.id);
    }

    getServerById = (id: string) => this.servers.find(s => s.id === id);

    getOperationById = (id: string) => this.operations.find(op => op.id === id);

    getFullOperationById = (id: string) => {
        const operation = this.getOperationById(id);

        if (operation) {
            const serverFull = this.getServerById(operation.serverId);

            return {
                ...operation,
                server: {
                    comfyAPI: serverFull.comfyAPI,
                    trainAPI: serverFull.trainAPI,
                    comfyHost: `http://${serverFull.comfyAPI}`,
                    comfyWsHost: `ws://${serverFull.comfyAPI}`,
                },
                queueNumber: this.getQueueNumber(operation)
            };
        }
    }

    completeOperation = (
        id: string,
        status: OPERATION_STATUS.SUCCESS |
            OPERATION_STATUS.ERROR |
            OPERATION_STATUS.CANCELED_BY_CLIENT |
            OPERATION_STATUS.CANCELED_BY_BALANCER
    ) => {
        const operation = this.getOperationById(id);

        if (operation) {
            operation.status = status;
        }
    }

    startOperationsByType = (types: OPERATION_TYPE[]) => {
        try {
            this.servers.forEach(server => {
                const operationsInProgress = this.operations.filter(
                    op => op.status === OPERATION_STATUS.IN_PROGRESS && op.serverId === server.id
                );

                if (!operationsInProgress.length) {
                    const operation = this.operations.find(
                        op => op.status === OPERATION_STATUS.WAITING && op.serverId === server.id
                    );

                    if (operation) {
                        operation.startTime = Date.now();
                        operation.status = OPERATION_STATUS.IN_PROGRESS;
                    }
                }
            });
        } catch (e) {
            this.logger.error('startOperationsByType', e);
        }
    }

    operationsLoop = async () => {
        try {
            const operationsInProgress = this.operations.filter(op => op.status === OPERATION_STATUS.IN_PROGRESS);

            operationsInProgress.forEach(op => {
                if (((Date.now() - op.startTime) / 1000) > MAX_EXECUTION_TIME[op.type]) {
                    this.completeOperation(op.id, OPERATION_STATUS.CANCELED_BY_BALANCER);
                }
            })

            this.startOperationsByType([
                OPERATION_TYPE.IMAGE_TO_IMAGE,
                OPERATION_TYPE.TEXT_TO_IMAGE,
                OPERATION_TYPE.TEXT_TO_IMAGES,
            ]);
            this.startOperationsByType([OPERATION_TYPE.TRAIN]);
        } catch (e) {
            this.logger.error('operationsLoop', e);
        }

        setTimeout(() => this.operationsLoop(), 100);
    }

    getServers = () => this.servers;

    getOperations = () => this.operations;

    getStats = () => {
        return {
            servers: this.servers.length,
            operations: this.operations.length
        }
    }

    getQueueNumber = (operation: IOperation): number => {
        return this.operations.filter(
            op => [OPERATION_STATUS.WAITING, OPERATION_STATUS.IN_PROGRESS].includes(op.status) &&
                op.serverId === operation.serverId
        ).filter(
            op => operation.type === OPERATION_TYPE.TRAIN ?
                op.type === OPERATION_TYPE.TRAIN :
                op.type !== OPERATION_TYPE.TRAIN
        ).findIndex(op => op.id === operation.id);
    }
}
