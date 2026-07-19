import styles from "./records-dashboard.module.css";

export default function RecordsLoading() {
  return (
    <main className={`fixed-dashboard ${styles.dashboard} ${styles.loading}`} aria-label="Loading learning records">
      <header className={styles.header}>
        <div className={styles.loadingHeading}><i /><b /><span /></div>
      </header>
      <section className={styles.scopeBar}><div className={styles.loadingTabs}>{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div></section>
      <div className={styles.body}>
        <aside className={styles.folderRail}><div className={styles.loadingList}>{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div></aside>
        <section className={styles.recordsPane}><div className={styles.loadingList}>{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div></section>
        <aside className={styles.progressRail}><div className={styles.loadingList}>{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div></aside>
      </div>
    </main>
  );
}
