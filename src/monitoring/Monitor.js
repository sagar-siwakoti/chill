import moment from 'moment';
import logger from '../utils/logger';
import * as events from '../services/events';
import * as statusService from '../services/status';
import * as persistence from '../services/persistence';

/**
 * The Monitor.
 */
class Monitor {
  /**
   * @param {Object} serviceConfig
   */
  constructor(serviceConfig) {
    this.retried = 0;
    this.status = null;
    this.config = serviceConfig;
    this.lastStatusChanged = null;
  }

  /**
   * Start the monitor.
   */
  start() {
    // TODO: We need to spawn each monitor into a separate thread,
    // such that each thread will monitor a service.
    events.trigger(
      events.EVENT_MONITORING_STARTED,
      { serviceName: this.config.name }
    );
    this.fetchLastStatus().then(() => this.startMonitoring());
  }

  /**
   * Fetch last status of the monitor.
   */
  async fetchLastStatus() {
    const { name } = this.config;
    const lastStatus = await persistence.getLastStatus(name);

    if (!lastStatus) {
      logger().info(`Last status for service '${name}' is unknown.`);

      return;
    }

    // Get the last persisted status information for this service.
    this.status = lastStatus.get('status');
    this.lastStatusChanged = lastStatus.get('createdAt');
    logger().info(
      `Service '${name}' was ${this.status} last time on ${moment(
        this.lastStatusChanged
      ).format()}.`
    );
  }

  /**
   * Start monitoring services.
   */
  async startMonitoring() {
    const { url, name, maxRetry, minInterval, maxInterval } = this.config;
    const status = await statusService.kHostStatus({ url, name });
    const interval = statusService.getCheckInterval(status, minInterval, maxInterval);

    logger().debug(`Status of service '${name}' now is '${status}'`);

    if (!this.shouldRetry(name, status, maxRetry) &&
        this.isStatusDifferent(status)) {
      this.handleStatusChange(status);
    }

    logger().debug(`Check interval for ${name} is ${interval}`);
    setTimeout(this.startMonitoring.bind(this), interval);
  }

  /**
   * Check current and previous status.
   *
   * @param {string} status
   */
  isStatusDifferent(status) {
    return (this.status !== status);
  }

  /**
   * Check if monitor should retry pinging.
   *
   * @param {string} name
   * @param {string} status
   * @param {number} maxRetry
   */
  shouldRetry(name, status, maxRetry) {
    if (status === statusService.STATUS_DOWN && this.retried <= maxRetry) {
      this.retried++;

      logger().info(`Service '${name}' retry count is ${this.retried}`);

      return true;
    }

    this.retried = 0;

    return false;
  }

  /**
   * Handle change in status and trigger a status change event.
   *
   * @param {string} status
   */
  handleStatusChange(status) {
    const currentTime = moment();
    const params = {
      status,
      time: currentTime.clone(),
      oldStatus: this.status,
      serviceName: this.config.name,
      lastStatusChanged: this.lastStatusChanged
        ? moment(this.lastStatusChanged).clone()
        : null
    };

    // Trigger the status change event.
    events.trigger(events.EVENT_STATUS_CHANGED, params);
    logger().debug(
      `Event triggered ${events.EVENT_STATUS_CHANGED} with params`,
      params
    );

    this.status = status;
    this.lastStatusChanged = currentTime; // Set the status changed date to current time.
  }
}

export default Monitor;
