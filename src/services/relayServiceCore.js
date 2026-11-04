class RelayService {
  constructor({ commandQueue, stateManager, monitorService, config, logger }) {
    this.commandQueue = commandQueue;
    this.stateManager = stateManager;
    this.monitorService = monitorService;
    this.config = config;
    this.logger = logger;
  }

  async setRelay(room, relayType, setValue, userRole = 'admin') {
    if (!this.config.app?.write_relay_enabled) {
      throw new Error('Write relay functionality is disabled');
    }

    if (userRole !== 'admin') {
      if (relayType === 'sub') {
        const roomState = this.stateManager.getRoomState(room);
        if (!roomState || !roomState.y_output_main) {
          throw new Error('User can only control sub relay when main relay is ON');
        }
      } else if (relayType === 'main') {
        throw new Error('User role cannot control main relay');
      }
    }

    const mapping = this.config.getRoomMapping(room);
    if (!mapping) {
      throw new Error(`Room ${room} not in mapping`);
    }

    const coilAddress = relayType === 'main' ? mapping.y_main_coil : mapping.y_sub_coil;
    const value = setValue.toLowerCase() === 'on';

    return new Promise((resolve, reject) => {
      const writeCallback = (error) => {
        if (error) {
          this.logger.error(`Relay write failed for room ${room} ${relayType}: ${error.message}`);
          reject(error);
          return;
        }

        try {
          const changed = this.stateManager.updateCoilState(room, relayType, value);

          if (changed) {
            this.logger.info(`Relay ${relayType} set to ${setValue} for room ${room}`);
            this.monitorService.emitStateUpdate();
          }

          if (relayType === 'main' && !value && this.config.app.interlock_enabled) {
            this.logger.debug(`Interlock: queuing sub relay OFF for room ${room}`);
            this.commandQueue.enqueueWriteCoil(mapping.floor, mapping.y_sub_coil, false);
          }

          resolve({
            room,
            status: value ? 'on' : 'off',
            type: relayType,
            floor: mapping.floor,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          this.logger.error(`Error processing relay write for room ${room}: ${error.message}`);
          reject(error);
        }
      };

      this.commandQueue.enqueueWriteCoil(
        mapping.floor,
        coilAddress,
        value,
        writeCallback
      );
    });
  }
}

export default RelayService;
