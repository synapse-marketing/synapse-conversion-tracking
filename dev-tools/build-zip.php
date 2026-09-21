<?php
// Build the installable plugin zip with forward-slash entries, one folder deep.
$src = $argv[1];
$dst = $argv[2];

$zip = new ZipArchive();
if ( true !== $zip->open( $dst, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
	fwrite( STDERR, "cannot open $dst\n" );
	exit( 1 );
}

$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $src, FilesystemIterator::SKIP_DOTS ) );
$count = 0;
foreach ( $it as $f ) {
	if ( ! $f->isFile() ) { continue; }
	$rel = substr( $f->getPathname(), strlen( $src ) + 1 );
	$rel = str_replace( '\\', '/', $rel );
	$zip->addFile( $f->getPathname(), 'synapse-conversion-tracking/' . $rel );
	$count++;
}
$zip->close();

// Verify.
$z = new ZipArchive();
$z->open( $dst );
$bad = 0; $main = false;
for ( $i = 0; $i < $z->numFiles; $i++ ) {
	$n = $z->getNameIndex( $i );
	if ( false !== strpos( $n, '\\' ) ) { $bad++; }
	if ( 'synapse-conversion-tracking/synapse-conversion-tracking.php' === $n ) { $main = true; }
}
echo 'FILES: ' . $z->numFiles . "\n";
echo 'BACKSLASH ENTRIES: ' . $bad . "\n";
echo 'MAIN ONE-DEEP: ' . ( $main ? 'YES' : 'NO!' ) . "\n";
echo 'SIZE: ' . round( filesize( $dst ) / 1024, 1 ) . " KB\n";
$z->close();
