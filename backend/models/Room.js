const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs'); // bcrypt 임포트 제거

const RoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  hasPassword: {
    type: Boolean,
    default: false
  },
  password: {
    type: String,
    select: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
});

// 비밀번호 해싱 미들웨어 제거
// RoomSchema.pre('save', async function(next) {
//   if (this.isModified('password') && this.password) {
//     const salt = await bcrypt.genSalt(10);
//     this.password = await bcrypt.hash(this.password, salt);
//     this.hasPassword = true;
//   }
//   if (!this.password) {
//     this.hasPassword = false;
//   }
//   next();
// });

// 비밀번호 확인 메서드 수정 (원문 비교)
RoomSchema.methods.checkPassword = async function(password) {
  if (!this.hasPassword) return true;
  const room = await this.constructor.findById(this._id).select('+password');
  // return await bcrypt.compare(password, room.password); // bcrypt 비교 제거
  return password === room.password; // 원문 비교
};

module.exports = mongoose.model('Room', RoomSchema);