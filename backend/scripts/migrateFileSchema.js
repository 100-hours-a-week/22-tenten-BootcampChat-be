/**
 * Migration script to update existing files with new schema fields
 * This script adds category, subtype, and other new fields to existing files
 */

const mongoose = require('mongoose');
const { FileTypeValidator } = require('../../shared/fileTypeConfig');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bootcamp-chat', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected for migration');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Define the File schema (current version without validation)
const FileSchema = new mongoose.Schema({}, { strict: false, collection: 'files' });
const File = mongoose.model('File', FileSchema);

const migrateFiles = async () => {
  try {
    console.log('🔄 Starting file schema migration...');
    
    // Get all files that need migration (missing category or other new fields)
    const filesToMigrate = await File.find({
      $or: [
        { category: { $exists: false } },
        { subtype: { $exists: false } },
        { metadata: { $exists: false } },
        { processing: { $exists: false } },
        { access: { $exists: false } }
      ]
    });

    console.log(`📁 Found ${filesToMigrate.length} files to migrate`);

    if (filesToMigrate.length === 0) {
      console.log('✅ No files need migration');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const file of filesToMigrate) {
      try {
        const updateData = {};
        
        // Determine category and subtype from MIME type
        if (!file.category || !file.subtype) {
          const validation = FileTypeValidator.validateFile(
            file.mimetype, 
            file.size, 
            file.originalname
          );
          
          if (validation.valid) {
            updateData.category = validation.category;
            updateData.subtype = validation.subtype;
          } else {
            updateData.category = 'other';
            updateData.subtype = null;
          }
        }

        // Initialize metadata if missing
        if (!file.metadata) {
          updateData.metadata = {};
          
          // Try to extract basic metadata based on file type
          if (updateData.category === 'image' || file.category === 'image') {
            updateData.metadata.dimensions = { width: null, height: null };
          } else if (updateData.category === 'video' || file.category === 'video') {
            updateData.metadata.duration = null;
            updateData.metadata.dimensions = { width: null, height: null };
            updateData.metadata.framerate = null;
          } else if (updateData.category === 'audio' || file.category === 'audio') {
            updateData.metadata.duration = null;
            updateData.metadata.bitrate = null;
            updateData.metadata.sampleRate = null;
            updateData.metadata.channels = null;
          }
        }

        // Initialize processing status if missing
        if (!file.processing) {
          updateData.processing = {
            status: 'completed',
            thumbnail: {
              generated: false
            },
            scanned: false
          };
        }

        // Initialize access tracking if missing
        if (!file.access) {
          updateData.access = {
            downloadCount: 0,
            viewCount: 0,
            sharedWith: []
          };
        }

        // Ensure uploadMethod is set (default to local for existing files)
        if (!file.uploadMethod) {
          updateData.uploadMethod = file.s3Key ? 's3_presigned' : 'local';
        }

        // Update the file
        await File.findByIdAndUpdate(file._id, updateData);
        successCount++;
        
        if (successCount % 100 === 0) {
          console.log(`✅ Migrated ${successCount} files...`);
        }

      } catch (error) {
        console.error(`❌ Error migrating file ${file._id}:`, error);
        errorCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully migrated: ${successCount} files`);
    console.log(`❌ Failed migrations: ${errorCount} files`);
    console.log(`📁 Total processed: ${filesToMigrate.length} files`);

    // Verify migration
    console.log('\n🔍 Verifying migration...');
    const filesWithoutCategory = await File.countDocuments({ category: { $exists: false } });
    const filesWithoutMetadata = await File.countDocuments({ metadata: { $exists: false } });
    const filesWithoutProcessing = await File.countDocuments({ processing: { $exists: false } });
    const filesWithoutAccess = await File.countDocuments({ access: { $exists: false } });

    console.log(`📊 Verification Results:`);
    console.log(`   Files without category: ${filesWithoutCategory}`);
    console.log(`   Files without metadata: ${filesWithoutMetadata}`);
    console.log(`   Files without processing: ${filesWithoutProcessing}`);
    console.log(`   Files without access: ${filesWithoutAccess}`);

    if (filesWithoutCategory === 0 && filesWithoutMetadata === 0 && 
        filesWithoutProcessing === 0 && filesWithoutAccess === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Some files may still need manual review');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

const createIndexes = async () => {
  try {
    console.log('\n🔄 Creating new indexes...');
    
    const File = mongoose.model('File');
    
    // Create the new compound indexes
    await File.collection.createIndex({ user: 1, category: 1, uploadDate: -1 });
    await File.collection.createIndex({ user: 1, uploadMethod: 1, uploadDate: -1 });
    await File.collection.createIndex({ category: 1, mimetype: 1 });
    await File.collection.createIndex({ 'processing.status': 1, uploadDate: -1 });
    await File.collection.createIndex({ expiresAt: 1 }, { sparse: true });
    
    console.log('✅ Indexes created successfully');
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    // Don't throw here as the migration can still be considered successful
  }
};

const showStats = async () => {
  try {
    console.log('\n📊 File Statistics After Migration:');
    
    const File = mongoose.model('File');
    
    const totalFiles = await File.countDocuments();
    console.log(`Total files: ${totalFiles}`);
    
    // Category breakdown
    const categoryStats = await File.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    console.log('\n📁 Files by Category:');
    categoryStats.forEach(stat => {
      console.log(`   ${stat._id}: ${stat.count}`);
    });
    
    // Upload method breakdown
    const uploadMethodStats = await File.aggregate([
      { $group: { _id: '$uploadMethod', count: { $sum: 1 } } }
    ]);
    
    console.log('\n🚀 Files by Upload Method:');
    uploadMethodStats.forEach(stat => {
      console.log(`   ${stat._id}: ${stat.count}`);
    });
    
    // Processing status breakdown
    const processingStats = await File.aggregate([
      { $group: { _id: '$processing.status', count: { $sum: 1 } } }
    ]);
    
    console.log('\n⚙️  Files by Processing Status:');
    processingStats.forEach(stat => {
      console.log(`   ${stat._id}: ${stat.count}`);
    });
    
  } catch (error) {
    console.error('❌ Error generating stats:', error);
  }
};

const main = async () => {
  try {
    await connectDB();
    await migrateFiles();
    await createIndexes();
    await showStats();
    
    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

// Run migration if called directly
if (require.main === module) {
  main();
}

module.exports = {
  migrateFiles,
  createIndexes,
  showStats
};